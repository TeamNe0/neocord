import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

interface PackageManifest {
  name: string;
  version: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

interface WorkspacePackage {
  directory: string;
  manifest: PackageManifest;
}

const rootDirectory = join(import.meta.dir, "..");
const packagesDirectory = join(rootDirectory, "packages");
const dryRun = process.argv.includes("--dry-run");

async function loadPublishablePackages(): Promise<WorkspacePackage[]> {
  const entries = await readdir(packagesDirectory, { withFileTypes: true });
  const packages: WorkspacePackage[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(packagesDirectory, entry.name);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as PackageManifest;
    if (!manifest.private) packages.push({ directory, manifest });
  }

  return packages;
}

function sortByDependencies(packages: WorkspacePackage[]): WorkspacePackage[] {
  const byName = new Map(packages.map((item) => [item.manifest.name, item]));
  const sorted: WorkspacePackage[] = [];
  const visited = new Set<string>();

  function visit(item: WorkspacePackage): void {
    if (visited.has(item.manifest.name)) return;
    visited.add(item.manifest.name);
    const names = [
      ...Object.keys(item.manifest.dependencies ?? {}),
      ...Object.keys(item.manifest.peerDependencies ?? {}),
    ];
    for (const name of names) {
      const dependency = byName.get(name);
      if (dependency) visit(dependency);
    }
    sorted.push(item);
  }

  for (const item of packages) visit(item);
  return sorted;
}

async function isPublished({ name, version }: PackageManifest): Promise<boolean> {
  const response = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}/${version}`);
  if (response.status === 404) return false;
  if (response.ok) return true;
  throw new Error(`Could not check ${name}@${version}: registry returned ${response.status}.`);
}

function run(command: string[], cwd: string): void {
  const result = Bun.spawnSync(command, { cwd, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) {
    throw new Error(`"${command.join(" ")}" failed with exit code ${result.exitCode}.`);
  }
}

const packages = sortByDependencies(await loadPublishablePackages());
let publishedCount = 0;

for (const { directory, manifest } of packages) {
  if (!dryRun && (await isPublished(manifest))) {
    console.log(`Skipping ${manifest.name}@${manifest.version}, already published.`);
    continue;
  }

  console.log(`${dryRun ? "Packing" : "Publishing"} ${manifest.name}@${manifest.version}`);
  run(["bun", "publish", "--access", "public", ...(dryRun ? ["--dry-run"] : [])], directory);
  publishedCount += 1;
}

if (!dryRun && publishedCount > 0) {
  run(["bunx", "changeset", "tag"], rootDirectory);
}

console.log(`${dryRun ? "Checked" : "Published"} ${publishedCount} package(s).`);

import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
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
  const result = Bun.spawnSync(command, { cwd, stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) {
    throw new Error(`"${command.join(" ")}" failed with exit code ${result.exitCode}.`);
  }
}

function readPackedManifest(directory: string, tarball: string): string {
  const result = Bun.spawnSync(["tar", "-xzOf", tarball, "package/package.json"], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) throw new Error(`Could not read ${tarball}: ${result.stderr.toString()}`);
  return result.stdout.toString();
}

function verifyPack({ directory, manifest }: WorkspacePackage, destination: string): void {
  const before = new Set(readdirSync(destination));
  run(["bun", "pm", "pack", "--destination", destination, "--quiet"], directory);
  const tarball = readdirSync(destination).find((entry) => !before.has(entry));
  if (!tarball) throw new Error(`Packing ${manifest.name} produced no tarball.`);

  const packed = JSON.parse(readPackedManifest(destination, tarball)) as PackageManifest;
  const ranges = { ...packed.dependencies, ...packed.peerDependencies };
  const unresolved = Object.entries(ranges).filter(([, range]) => /^(workspace|catalog):/.test(range));
  if (unresolved.length > 0) {
    throw new Error(`${manifest.name} would publish unresolved ranges: ${unresolved.map(([name]) => name).join(", ")}.`);
  }
}

const packages = sortByDependencies(await loadPublishablePackages());
const packDirectory = dryRun ? mkdtempSync(join(tmpdir(), "neocord-pack-")) : null;
let publishedCount = 0;

for (const item of packages) {
  const { directory, manifest } = item;
  if (packDirectory !== null) {
    console.log(`Packing ${manifest.name}@${manifest.version}`);
    verifyPack(item, packDirectory);
    publishedCount += 1;
    continue;
  }

  if (await isPublished(manifest)) {
    console.log(`Skipping ${manifest.name}@${manifest.version}, already published.`);
    continue;
  }

  console.log(`Publishing ${manifest.name}@${manifest.version}`);
  run(["bun", "publish", "--access", "public"], directory);
  publishedCount += 1;
}

if (packDirectory !== null) rmSync(packDirectory, { recursive: true, force: true, maxRetries: 3 });

if (!dryRun && publishedCount > 0) {
  run(["bunx", "changeset", "git-tag"], rootDirectory);
}

console.log(`${dryRun ? "Checked" : "Published"} ${publishedCount} package(s).`);

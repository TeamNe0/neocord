import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

interface Scenario {
  name: string;
  flags: string[];
  runtime: "bun" | "node";
  prepare?: string[][];
}

interface StepResult {
  scenario: string;
  step: string;
  passed: boolean;
  detail: string;
}

const repositoryRoot = join(import.meta.dir, "..");
const packageDirectories = ["routing", "react", "neocord", "cli", "eslint-plugin"];
const scenarios: Scenario[] = [
  { name: "base", flags: ["--db", "none", "--eslint"], runtime: "bun" },
  { name: "base-node", flags: ["--db", "none", "--eslint"], runtime: "node" },
  { name: "no-eslint", flags: ["--db", "none", "--no-eslint"], runtime: "bun" },
  {
    name: "drizzle-sqlite",
    flags: ["--db", "drizzle", "--dialect", "sqlite", "--eslint"],
    runtime: "bun",
    prepare: [["bun", "run", "db:push"]],
  },
  {
    name: "prisma-sqlite",
    flags: ["--db", "prisma", "--dialect", "sqlite", "--eslint"],
    runtime: "bun",
    prepare: [["bun", "run", "db:push"]],
  },
];

const selected = process.argv.slice(2);
const results: StepResult[] = [];

function exec(command: string[], cwd: string, env: Record<string, string> = {}) {
  const result = Bun.spawnSync(command, {
    cwd,
    env: { ...process.env, CI: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    code: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
}

function record(scenario: string, step: string, passed: boolean, detail: string): void {
  results.push({ scenario, step, passed, detail });
  console.log(`${passed ? "pass" : "FAIL"}  ${scenario}  ${step}`);
  if (!passed) console.log(detail.trim().split("\n").slice(-40).join("\n"));
}

function run(scenario: string, step: string, command: string[], cwd: string, env: Record<string, string> = {}): boolean {
  const result = exec(command, cwd, env);
  record(scenario, step, result.code === 0, result.output);
  return result.code === 0;
}

function packTarballs(destination: string): Map<string, string> {
  const tarballs = new Map<string, string>();

  for (const directory of packageDirectories) {
    const packageRoot = join(repositoryRoot, "packages", directory);
    const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as { name: string };
    const before = new Set(readdirSync(destination));
    const packed = exec(["bun", "pm", "pack", "--destination", destination], packageRoot);
    if (packed.code !== 0) throw new Error(`Packing ${manifest.name} failed:\n${packed.output}`);
    const file = readdirSync(destination).find((entry) => !before.has(entry));
    if (!file) throw new Error(`Packing ${manifest.name} produced no tarball.`);
    tarballs.set(manifest.name, join(destination, file));
  }

  return tarballs;
}

function addLocalOverrides(projectRoot: string, tarballs: Map<string, string>): void {
  const manifestPath = join(projectRoot, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
  const specs = Object.fromEntries([...tarballs].map(([name, file]) => [name, `file:${file}`]));
  manifest.overrides = specs;
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

function forceRuntime(projectRoot: string, runtime: Scenario["runtime"]): void {
  const configPath = join(projectRoot, "neocord.config.ts");
  const source = readFileSync(configPath, "utf8");
  const updated = source.replace("defineConfig({", `defineConfig({\n  runtime: "${runtime}",`);
  if (updated === source) throw new Error("Could not set the runtime in neocord.config.ts.");
  writeFileSync(configPath, updated);
}

function verifyStartupFailure(scenario: Scenario, projectRoot: string): void {
  const result = exec(["bun", "run", "start"], projectRoot, {
    DISCORD_TOKEN: "invalid.token.value",
    DATABASE_URL: "file:./local.db",
    NEOCORD_SHARD_COUNT: "1",
  });
  const actionable = /token/i.test(result.output) && !result.output.includes("invalid.token.value");
  record(scenario.name, "start reports invalid token without leaking it", result.code !== 0 && actionable, result.output);
}

function runScenario(scenario: Scenario, workspace: string, tarballs: Map<string, string>): void {
  const projectRoot = join(workspace, scenario.name);
  const createBin = join(repositoryRoot, "packages/create-neocord/dist/bin.js");
  const created = run(
    scenario.name,
    "scaffold",
    ["node", createBin, projectRoot, "--yes", "--no-install", "--no-git", "--pm", "bun", ...scenario.flags],
    workspace,
  );
  if (!created) return;

  addLocalOverrides(projectRoot, tarballs);
  forceRuntime(projectRoot, scenario.runtime);
  if (!run(scenario.name, "install", ["bun", "install"], projectRoot)) return;

  const env = { DATABASE_URL: "file:./local.db" };
  for (const command of scenario.prepare ?? []) {
    run(scenario.name, command.join(" "), command, projectRoot, env);
  }

  run(scenario.name, "typecheck", ["bun", "run", "typecheck"], projectRoot, env);
  if (scenario.flags.includes("--eslint")) run(scenario.name, "lint", ["bun", "run", "lint"], projectRoot, env);
  run(scenario.name, "test", ["bun", "run", "test"], projectRoot, env);
  run(scenario.name, "routes", ["bunx", "--bun", "neocord", "routes"], projectRoot, env);
  if (!run(scenario.name, "build", ["bun", "run", "build"], projectRoot, env)) return;
  for (const file of ["shard.js", "manager.js", "deploy.js"]) {
    const exists = existsSync(join(projectRoot, ".neocord/build", file));
    record(scenario.name, `build output ${file}`, exists, "missing");
  }
  run(scenario.name, "deploy dry run", ["bunx", "--bun", "neocord", "deploy", "--dry-run"], projectRoot, env);
  run(scenario.name, "deploy clear dry run", ["bunx", "--bun", "neocord", "deploy", "--dry-run", "--clear"], projectRoot, env);

  const bare = exec(["node", join(projectRoot, "node_modules/@teamneo/neocord-cli/dist/bin.js"), "routes"], projectRoot, env);
  record(scenario.name, "cli runs under node", bare.code === 0, bare.output);

  verifyStartupFailure(scenario, projectRoot);
}

const workspace = mkdtempSync(join(tmpdir(), "neocord-e2e-"));
const tarballDirectory = join(workspace, "tarballs");
mkdirSync(tarballDirectory);

console.log(`Workspace: ${workspace}`);
const tarballs = packTarballs(tarballDirectory);

for (const scenario of scenarios) {
  if (selected.length === 0 || selected.includes(scenario.name)) runScenario(scenario, workspace, tarballs);
}

const failures = results.filter((result) => !result.passed);
console.log(`\n${results.length - failures.length} passed, ${failures.length} failed`);

if (failures.length === 0) {
  rmSync(workspace, { recursive: true, force: true, maxRetries: 3 });
} else {
  console.log(`Kept ${workspace} for inspection.`);
  process.exitCode = 1;
}

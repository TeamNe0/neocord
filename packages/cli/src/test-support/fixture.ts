import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const BIN = join(PACKAGE_ROOT, "dist", "bin.js");
export const LONG_TIMEOUT = 60_000;

const STUB_RUNTIME = `import { appendFileSync } from "node:fs";

const log = new URL("../../calls.jsonl", import.meta.url);

function snapshotEnv() {
  return {
    NODE_ENV: process.env.NODE_ENV,
    SKIP_ENV_VALIDATION: process.env.SKIP_ENV_VALIDATION,
    NEOCORD_SHARD_COUNT: process.env.NEOCORD_SHARD_COUNT,
    FIXTURE_VALUE: process.env.FIXTURE_VALUE,
  };
}

function record(call, data) {
  const runtime = process.versions.bun ? "bun" : "node";
  appendFileSync(log, JSON.stringify({ call, runtime, env: snapshotEnv(), ...data }) + "\\n");
}

function summarize(manifest) {
  return {
    version: manifest.version,
    hasContext: manifest.context !== null,
    features: manifest.features.map((feature) => ({ name: feature.name, hasModule: feature.module !== null })),
    groups: manifest.groups.map((group) => ({ segments: group.segments, file: group.file })),
    routes: manifest.routes.map((route) => ({
      kind: route.kind,
      id: route.id,
      file: route.file,
      middleware: route.middleware.map((item) => item.file),
      layouts: route.layouts.map((item) => item.file),
      error: route.error?.file ?? null,
      loading: route.loading?.file ?? null,
      rendered: typeof route.module.default?.render === "function" ? route.module.default.render() : null,
    })),
  };
}

export async function startBot({ config, manifest }) {
  record("startBot", { config: { intents: config.intents }, manifest: summarize(manifest) });
  if (process.env.STUB_EXIT_CODE) process.exit(Number(process.env.STUB_EXIT_CODE));
  if (process.env.STUB_STAY_ALIVE) setInterval(() => {}, 1000);
}

export async function startManager({ config, shardFile, shards }) {
  record("startManager", { config: { intents: config.intents }, shardFile: String(shardFile), shards: shards ?? null });
  if (process.env.STUB_EXIT_CODE) process.exit(Number(process.env.STUB_EXIT_CODE));
  if (process.env.STUB_STAY_ALIVE) setInterval(() => {}, 1000);
}

export function serializeCommands(manifest) {
  if (process.env.STUB_SERIALIZE_THROWS) throw new Error(process.env.STUB_SERIALIZE_THROWS);
  return manifest.routes
    .filter((route) => route.kind === "command")
    .map((route) => ({ name: route.segments[0], description: "stub", type: 1 }));
}

export function validateManifest(manifest) {
  record("validateManifest", { routeCount: manifest.routes.length });
  return process.env.STUB_VALIDATE_ISSUES ? JSON.parse(process.env.STUB_VALIDATE_ISSUES) : [];
}

export async function deployCommands({ manifest, guildId, force, dryRun, stateFile }) {
  record("deployCommands", {
    guildId: guildId ?? null,
    force: force ?? false,
    dryRun: dryRun ?? false,
    stateFile: stateFile ?? null,
  });
  if (process.env.STUB_DEPLOY_THROWS) throw new Error(process.env.STUB_DEPLOY_THROWS);
  const commands = serializeCommands(manifest);
  return {
    status: dryRun ? "dry-run" : "deployed",
    scope: guildId ? "guild" : "global",
    ...(guildId ? { guildId } : {}),
    commandCount: commands.length,
    hash: "stubhash",
    commands,
  };
}
`;

const STUB_JSX_RUNTIME = `export const Fragment = "fragment";
export function jsx(type, props) {
  return { type, props };
}
export const jsxs = jsx;
`;

export interface CallRecord {
  call: string;
  runtime: "bun" | "node";
  env: Record<string, string | undefined>;
  [key: string]: unknown;
}

export interface Fixture {
  root: string;
  write(path: string, content: string): void;
  read(path: string): string;
  exists(path: string): boolean;
  remove(path: string): void;
  calls(): CallRecord[];
  clearCalls(): void;
  cleanup(): void;
}

export interface FixtureOptions {
  files?: Record<string, string>;
  packageJson?: Record<string, unknown>;
  stubs?: boolean;
  config?: string;
}

export const DEFAULT_CONFIG = `export default { intents: ["Guilds"], runtime: "node" };\n`;

export const STANDARD_FILES: Record<string, string> = {
  "src/context.ts": `export default { __neocord: "context" };\n`,
  "src/middleware.ts": `export default { __neocord: "middleware" };\n`,
  "src/layout.tsx": `export default function Layout({ children }: { children: unknown }) { return <root>{children}</root>; }\n`,
  "src/error.tsx": `export default function ErrorView() { return <error />; }\n`,
  "src/loading.tsx": `export default function Loading() { return <loading />; }\n`,
  "src/env.ts": `export const env = { FIXTURE_VALUE: process.env.FIXTURE_VALUE };\n`,
  "src/lib/ignored.ts": `export const ignored = true;\n`,
  "src/features/moderation/feature.ts": `export default { __neocord: "feature" };\n`,
  "src/features/moderation/middleware.ts": `export default { __neocord: "middleware" };\n`,
  "src/features/moderation/layout.tsx": `export default function Layout({ children }: { children: unknown }) { return <moderation>{children}</moderation>; }\n`,
  "src/features/moderation/error.tsx": `export default function ErrorView() { return <mod-error />; }\n`,
  "src/features/moderation/_lib/helper.ts": `export const helper = 1;\n`,
  "src/features/moderation/commands/ban/command.tsx": `export default { __neocord: "command", render() { return <ban reason="spam">hello</ban>; } };\n`,
  "src/features/moderation/commands/ban/middleware.ts": `export default { __neocord: "middleware" };\n`,
  "src/features/moderation/commands/ban/command.test.tsx": `export const notARoute = true;\n`,
  "src/features/moderation/commands/(staff)/layout.tsx": `export default function Layout({ children }: { children: unknown }) { return <staff>{children}</staff>; }\n`,
  "src/features/moderation/commands/(staff)/mod/group.ts": `export default { __neocord: "group" };\n`,
  "src/features/moderation/commands/(staff)/mod/warn/command.tsx": `export default { __neocord: "command" };\n`,
  "src/features/moderation/commands/(staff)/mod/case/view/command.tsx": `export default { __neocord: "command" };\n`,
  "src/features/moderation/user-commands/report/command.tsx": `export default { __neocord: "user-command" };\n`,
  "src/features/moderation/message-commands/quote/command.tsx": `export default { __neocord: "message-command" };\n`,
  "src/features/moderation/buttons/confirm-ban/[userId]/button.tsx": `export default { __neocord: "button" };\n`,
  "src/features/moderation/buttons/pages/[...rest]/button.tsx": `export default { __neocord: "button" };\n`,
  "src/features/moderation/selects/pick-role/select.tsx": `export default { __neocord: "select" };\n`,
  "src/features/moderation/modals/ban-reason/[userId]/modal.tsx": `export default { __neocord: "modal" };\n`,
  "src/features/moderation/events/guildMemberAdd.ts": `export default { __neocord: "event" };\n`,
  "src/features/moderation/events/guildMemberAdd/welcome.ts": `export default { __neocord: "event" };\n`,
  "src/features/moderation/tasks/cleanup.ts": `export default { __neocord: "task" };\n`,
  "src/features/general/commands/ping/command.tsx": `export default { __neocord: "command" };\n`,
  "src/features/general/buttons/refresh/button.tsx": `export default { __neocord: "button" };\n`,
};

export function createFixture(options: FixtureOptions = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "neocord cli test "));

  const write = (path: string, content: string): void => {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  };

  write("package.json", JSON.stringify({ name: "fixture", type: "module", ...options.packageJson }, null, 2));
  write("neocord.config.ts", options.config ?? DEFAULT_CONFIG);

  if (options.stubs !== false) {
    write(
      "node_modules/neocord/package.json",
      JSON.stringify({
        name: "neocord",
        version: "9.9.9",
        type: "module",
        exports: { ".": "./index.js", "./runtime": "./runtime.js" },
      }),
    );
    write("node_modules/neocord/index.js", "export const defineConfig = (config) => config;\n");
    write("node_modules/neocord/runtime.js", STUB_RUNTIME);
    write(
      "node_modules/react/package.json",
      JSON.stringify({
        name: "react",
        version: "19.9.9",
        type: "module",
        exports: { "./jsx-runtime": "./jsx-runtime.js" },
      }),
    );
    write("node_modules/react/jsx-runtime.js", STUB_JSX_RUNTIME);
  }

  for (const [path, content] of Object.entries(options.files ?? {})) write(path, content);

  const callsFile = join(root, "calls.jsonl");
  return {
    root,
    write,
    read: (path) => readFileSync(join(root, path), "utf8"),
    exists: (path) => existsSync(join(root, path)),
    remove: (path) => rmSync(join(root, path), { recursive: true, force: true }),
    calls: () =>
      existsSync(callsFile)
        ? readFileSync(callsFile, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as CallRecord)
        : [],
    clearCalls: () => rmSync(callsFile, { force: true }),
    cleanup: () => rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }),
  };
}

export interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  runtime?: "node" | "bun";
}

export function nodeCommand(): string {
  const found = Bun.which("node");
  if (found === null) throw new Error("node is required to run the CLI tests");
  return found;
}

export function bunCommand(): string {
  return process.execPath;
}

export function cleanEnv(overrides: Record<string, string | undefined> = {}): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (/^(npm_|BUN_|NODE_ENV$|DISCORD_TOKEN$|SKIP_ENV_VALIDATION$|FORCE_COLOR$)/i.test(key)) continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete env[key];
    else env[key] = value;
  }
  return env;
}

export function runCli(args: readonly string[], options: RunOptions = {}): Promise<CliResult> {
  const command = options.runtime === "bun" ? bunCommand() : nodeCommand();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, [BIN, ...args], {
      cwd: options.cwd ?? PACKAGE_ROOT,
      env: cleanEnv(options.env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolvePromise({ code: code ?? 1, stdout, stderr }));
  });
}

export function ensureDist(): void {
  const tsc = join(PACKAGE_ROOT, "node_modules", "@typescript", "native", "bin", "tsc");
  const result = spawnSync(nodeCommand(), [tsc, "-p", "tsconfig.build.json"], {
    cwd: PACKAGE_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`Failed to build dist:\n${result.stdout}\n${result.stderr}`);
}

export function runTsc(root: string): { code: number; output: string } {
  const tsc = join(PACKAGE_ROOT, "node_modules", "@typescript", "native", "bin", "tsc");
  const result = spawnSync(nodeCommand(), [tsc, "-p", "tsconfig.json", "--pretty", "false"], {
    cwd: root,
    encoding: "utf8",
  });
  return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}` };
}

export function createCapture(): {
  stream: { write(text: string): boolean };
  text(): string;
} {
  let buffer = "";
  return {
    stream: {
      write(text: string) {
        buffer += text;
        return true;
      },
    },
    text: () => buffer,
  };
}

export async function waitUntil(condition: () => boolean, timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition");
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25));
  }
}

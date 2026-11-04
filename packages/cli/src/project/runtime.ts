import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import { CliError } from "../errors.ts";
import type { RuntimePreference } from "./config.ts";

export interface ResolvedRuntime {
  name: "bun" | "node";
  command: string;
  args: string[];
}

export interface RuntimeContext {
  bunVersion: string | undefined;
  execPath: string;
  env: Record<string, string | undefined>;
  platform: NodeJS.Platform;
}

export function currentRuntimeContext(): RuntimeContext {
  return {
    bunVersion: process.versions.bun,
    execPath: process.execPath,
    env: process.env,
    platform: process.platform,
  };
}

function readEnvInsensitive(env: Record<string, string | undefined>, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name);
  return key === undefined ? undefined : env[key];
}

function isRunnable(file: string, platform: NodeJS.Platform): boolean {
  try {
    if (!statSync(file).isFile()) return false;
    if (platform !== "win32") accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function findExecutable(name: string, context: RuntimeContext = currentRuntimeContext()): string | null {
  const directories = (readEnvInsensitive(context.env, "PATH") ?? "").split(delimiter).filter(Boolean);
  const extensions =
    context.platform === "win32"
      ? (readEnvInsensitive(context.env, "PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
      : [""];
  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`);
      if (isRunnable(candidate, context.platform)) return candidate;
    }
  }
  return null;
}

export function findBun(context: RuntimeContext = currentRuntimeContext()): string | null {
  if (context.bunVersion !== undefined) return context.execPath;
  const found = findExecutable("bun", context);
  if (found === null || context.platform !== "win32" || !/\.(cmd|bat)$/i.test(found)) return found;
  const nativeBinary = join(dirname(found), "node_modules", "bun", "bin", "bun.exe");
  return existsSync(nativeBinary) ? nativeBinary : null;
}

export function findNode(context: RuntimeContext = currentRuntimeContext()): string | null {
  if (context.bunVersion === undefined) return context.execPath;
  return findExecutable("node", context);
}

export function invokedThroughBun(context: RuntimeContext): boolean {
  return context.bunVersion !== undefined || (context.env.npm_config_user_agent ?? "").startsWith("bun");
}

function bunRuntime(command: string): ResolvedRuntime {
  return { name: "bun", command, args: ["--no-env-file"] };
}

export function resolveRuntime(
  preference: RuntimePreference,
  context: RuntimeContext = currentRuntimeContext(),
): ResolvedRuntime {
  if (preference === "bun" || (preference === "auto" && invokedThroughBun(context))) {
    const bun = findBun(context);
    if (bun !== null) return bunRuntime(bun);
    if (preference === "bun") {
      throw new CliError('The config sets runtime: "bun", but bun was not found on PATH.', {
        hint: 'Install it from https://bun.com/docs/installation, or set runtime: "node" in neocord.config.',
      });
    }
  }
  const node = findNode(context);
  if (node === null) {
    throw new CliError('The config selects the "node" runtime, but node was not found on PATH.', {
      hint: 'Install Node.js 22.12 or newer, or set runtime: "bun" in neocord.config.',
    });
  }
  return { name: "node", command: node, args: ["--enable-source-maps"] };
}

export function resolveToolRunner(context: RuntimeContext = currentRuntimeContext()): string {
  return findNode(context) ?? context.execPath;
}

function findPackageManifest(root: string, packageName: string): string | null {
  let directory = root;
  while (true) {
    const candidate = join(directory, "node_modules", ...packageName.split("/"), "package.json");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function readJsonObject(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export function readInstalledVersion(root: string, packageName: string): string | null {
  const manifest = findPackageManifest(root, packageName);
  if (manifest === null) return null;
  const version = readJsonObject(manifest)?.version;
  return typeof version === "string" ? version : null;
}

export function resolvePackageBin(root: string, packageName: string, binName: string = packageName): string | null {
  const manifest = findPackageManifest(root, packageName);
  if (manifest === null) return null;
  const bin = readJsonObject(manifest)?.bin;
  const relativePath =
    typeof bin === "string" ? bin : typeof bin === "object" && bin !== null ? (bin as Record<string, unknown>)[binName] : undefined;
  if (typeof relativePath !== "string") return null;
  const file = join(dirname(manifest), relativePath);
  return existsSync(file) ? file : null;
}

export function projectDependsOn(root: string, packageName: string): boolean {
  const manifest = readJsonObject(join(root, "package.json"));
  if (manifest === null) return false;
  return ["dependencies", "devDependencies", "optionalDependencies"].some((field) => {
    const section = manifest[field];
    return typeof section === "object" && section !== null && packageName in section;
  });
}

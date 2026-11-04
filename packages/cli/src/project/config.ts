import { copyFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build, type BuildFailure } from "esbuild";
import { normalizePath } from "@neocord/routing";
import { CliError, errorMessage } from "../errors.ts";
import { findConfigFile, projectPaths, toPosix } from "./paths.ts";

export type RuntimePreference = "auto" | "bun" | "node";
export type DeployMode = "manual" | "auto";

export interface CliConfig {
  sourceDir: string;
  featuresDir: string;
  runtime: RuntimePreference;
  dev: { guildId: string | undefined; shards: number };
  deploy: { mode: DeployMode };
}

export interface LoadConfigOptions {
  root: string;
  configFile?: string;
}

export interface LoadedConfig {
  file: string;
  config: CliConfig;
  raw: unknown;
}

export class ConfigError extends CliError {
  override readonly name: string = "ConfigError";
}

export class EnvValidationError extends CliError {
  override readonly name: string = "EnvValidationError";
}

const RUNTIMES: readonly RuntimePreference[] = ["auto", "bun", "node"];
const DEPLOY_MODES: readonly DeployMode[] = ["manual", "auto"];
const ENV_FAILURE = /invalid environment variables/i;

let importCounter = 0;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBuildFailure(error: unknown): error is BuildFailure {
  return error instanceof Error && Array.isArray((error as Partial<BuildFailure>).errors);
}

async function bundleConfig(root: string, configFile: string): Promise<string> {
  const paths = projectPaths(root);
  await mkdir(paths.cacheDir, { recursive: true });
  const outfile = join(paths.cacheDir, "config.mjs");
  try {
    await build({
      absWorkingDir: root,
      entryPoints: [configFile],
      outfile,
      bundle: true,
      packages: "external",
      platform: "node",
      format: "esm",
      target: "node22",
      jsx: "automatic",
      logLevel: "silent",
      ...(existsSync(paths.tsconfig) ? { tsconfig: paths.tsconfig } : {}),
    });
  } catch (error) {
    if (isBuildFailure(error)) {
      throw new ConfigError(`Could not bundle ${toPosix(relative(root, configFile))}.`, {
        details: error.errors.map((message) =>
          message.location
            ? `${message.location.file}:${message.location.line}:${message.location.column}: ${message.text}`
            : message.text,
        ),
      });
    }
    throw error;
  }
  return outfile;
}

async function importBundled(file: string): Promise<unknown> {
  importCounter += 1;
  const stamp = `${Date.now()}-${importCounter}`;
  if (process.versions.bun === undefined) {
    return import(`${pathToFileURL(file).href}?t=${stamp}`);
  }
  const copy = file.replace(/\.mjs$/, `-${stamp}.mjs`);
  await copyFile(file, copy);
  try {
    return await import(pathToFileURL(copy).href);
  } finally {
    await rm(copy, { force: true });
  }
}

function formatIssuePath(path: unknown): string | null {
  if (!Array.isArray(path) || path.length === 0) return null;
  return path
    .map((part: unknown) => (isRecord(part) && "key" in part ? String(part.key) : String(part)))
    .join(".");
}

function formatEnvIssues(captured: readonly (readonly unknown[])[]): string[] {
  const details: string[] = [];
  for (const args of captured) {
    if (typeof args[0] !== "string" || !ENV_FAILURE.test(args[0])) continue;
    const issues = args[1];
    if (Array.isArray(issues)) {
      for (const issue of issues as unknown[]) {
        if (!isRecord(issue)) continue;
        const path = formatIssuePath(issue.path);
        const message = typeof issue.message === "string" ? issue.message : "Invalid value";
        details.push(path ? `${path}: ${message}` : message);
      }
    } else if (isRecord(issues)) {
      for (const [key, messages] of Object.entries(issues)) {
        details.push(`${key}: ${Array.isArray(messages) ? messages.join(", ") : String(messages)}`);
      }
    }
  }
  return details;
}

async function importConfig(file: string, displayName: string): Promise<unknown> {
  const captured: unknown[][] = [];
  const originalConsoleError = console.error;
  console.error = (...args: unknown[]) => {
    captured.push(args);
  };
  let failure: { error: unknown } | null = null;
  let module: unknown;
  try {
    module = await importBundled(file);
  } catch (error) {
    failure = { error };
  } finally {
    console.error = originalConsoleError;
  }

  const environmentFailed = failure !== null && ENV_FAILURE.test(errorMessage(failure.error));
  if (!environmentFailed) {
    for (const args of captured) console.error(...args);
  }
  if (failure === null) return module;

  if (environmentFailed) {
    throw new EnvValidationError("Environment validation failed.", {
      details: formatEnvIssues(captured),
      hint: "Set the missing variables in the environment or a .env file.",
    });
  }
  throw new ConfigError(`Could not load ${displayName}: ${errorMessage(failure.error)}`);
}

function readDirectory(root: string, value: unknown, field: string, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value.length === 0) {
    throw new ConfigError(`Config field "${field}" must be a non-empty string.`);
  }
  const absolute = isAbsolute(value) ? value : resolve(root, value);
  const inside = relative(root, absolute);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) {
    throw new ConfigError(`Config field "${field}" must point to a folder inside the project, got "${value}".`);
  }
  return normalizePath(toPosix(inside)).replace(/\/+$/, "");
}

function readEnum<T extends string>(value: unknown, allowed: readonly T[], field: string, fallback: T): T {
  if (value === undefined) return fallback;
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) return value as T;
  throw new ConfigError(
    `Config field "${field}" must be one of ${allowed.map((item) => `"${item}"`).join(", ")}, got ${JSON.stringify(value)}.`,
  );
}

function readSection(value: unknown, field: string): Record<string, unknown> {
  if (value === undefined) return {};
  if (!isRecord(value)) throw new ConfigError(`Config field "${field}" must be an object.`);
  return value;
}

export function parseCliConfig(root: string, raw: unknown): CliConfig {
  if (!isRecord(raw)) {
    throw new ConfigError("The neocord config must default-export the result of defineConfig({ ... }).");
  }
  const sourceDir = readDirectory(root, raw.sourceDir, "sourceDir", "src");
  const featuresDir = readDirectory(root, raw.featuresDir, "featuresDir", `${sourceDir}/features`);
  const dev = readSection(raw.dev, "dev");
  const deploy = readSection(raw.deploy, "deploy");

  const shards = dev.shards ?? 1;
  if (typeof shards !== "number" || !Number.isInteger(shards) || shards < 1) {
    throw new ConfigError(`Config field "dev.shards" must be a positive integer, got ${JSON.stringify(shards)}.`);
  }
  const guildId = dev.guildId;
  if (guildId !== undefined && guildId !== null && typeof guildId !== "string") {
    throw new ConfigError('Config field "dev.guildId" must be a string.');
  }

  return {
    sourceDir,
    featuresDir,
    runtime: readEnum(raw.runtime, RUNTIMES, "runtime", "auto"),
    dev: { guildId: guildId || undefined, shards },
    deploy: { mode: readEnum(deploy.mode, DEPLOY_MODES, "deploy.mode", "manual") },
  };
}

export async function loadConfig(options: LoadConfigOptions): Promise<LoadedConfig> {
  const root = options.root;
  const configFile = options.configFile ?? findConfigFile(root);
  if (!configFile) {
    throw new ConfigError(`No neocord.config file found in "${root}".`, {
      hint: "Start a new project with: bun create neocord",
    });
  }
  const displayName = toPosix(relative(root, configFile));
  const bundled = await bundleConfig(root, configFile);
  const module = await importConfig(bundled, displayName);
  const raw = isRecord(module) ? module.default : undefined;
  if (raw === undefined) {
    throw new ConfigError(`${displayName} has no default export.`, {
      hint: "Add: export default defineConfig({ ... })",
    });
  }
  return { file: configFile, config: parseCliConfig(root, raw), raw };
}

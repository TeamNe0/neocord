import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "dotenv";

export type EnvMode = "development" | "production" | "test";

export const SKIP_ENV_VALIDATION = "SKIP_ENV_VALIDATION";

const ALL_MODES: readonly EnvMode[] = ["development", "production", "test"];

export interface LoadEnvOptions {
  root: string;
  mode: EnvMode;
  env?: Record<string, string | undefined>;
  bunAutoload?: boolean;
  skipValidation?: boolean;
}

export interface LoadedEnv {
  mode: EnvMode;
  env: Record<string, string>;
  files: string[];
  fromFiles: Record<string, string>;
}

export function envFileNames(mode: EnvMode): string[] {
  const shared = mode === "test" ? [] : [".env.local"];
  return [".env", `.env.${mode}`, ...shared, `.env.${mode}.local`];
}

function readEnvFile(root: string, name: string): Record<string, string> | null {
  const file = join(root, name);
  return existsSync(file) ? parse(readFileSync(file)) : null;
}

function definedEntries(env: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function dropBunAutoloaded(root: string, env: Record<string, string>): void {
  const names = new Set(ALL_MODES.flatMap(envFileNames));
  for (const name of names) {
    const parsed = readEnvFile(root, name);
    if (!parsed) continue;
    for (const [key, value] of Object.entries(parsed)) {
      if (env[key] === value) delete env[key];
    }
  }
}

export function loadEnvFiles(options: LoadEnvOptions): LoadedEnv {
  const real = definedEntries(options.env ?? process.env);
  if (options.bunAutoload ?? process.versions.bun !== undefined) {
    dropBunAutoloaded(options.root, real);
  }

  const fromFiles: Record<string, string> = {};
  const files: string[] = [];
  for (const name of envFileNames(options.mode)) {
    const parsed = readEnvFile(options.root, name);
    if (!parsed) continue;
    files.push(name);
    Object.assign(fromFiles, parsed);
  }

  const env: Record<string, string> = { ...fromFiles, ...real, NODE_ENV: options.mode };
  if (options.skipValidation && env[SKIP_ENV_VALIDATION] === undefined) {
    env[SKIP_ENV_VALIDATION] = "true";
  }
  return { mode: options.mode, env, files, fromFiles };
}

export function applyEnv(target: NodeJS.ProcessEnv, next: Record<string, string>): void {
  for (const key of Object.keys(target)) {
    if (!Object.hasOwn(next, key)) delete target[key];
  }
  for (const [key, value] of Object.entries(next)) {
    if (target[key] !== value) target[key] = value;
  }
}

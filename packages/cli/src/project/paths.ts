import { existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { CliError } from "../errors.ts";

export const CONFIG_FILE_NAMES = [
  "neocord.config.ts",
  "neocord.config.mts",
  "neocord.config.js",
  "neocord.config.mjs",
] as const;

export type EntryName = "shard" | "manager" | "deploy" | "validate";

export interface ProjectPaths {
  root: string;
  neocordDir: string;
  manifest: string;
  types: string;
  entriesDir: string;
  buildDir: string;
  buildInputs: string;
  devDir: string;
  cacheDir: string;
  deployState: string;
  devDeployState: string;
  tsconfig: string;
}

export interface ProjectLocation {
  root: string;
  configFile: string;
}

export function projectPaths(root: string): ProjectPaths {
  const neocordDir = join(root, ".neocord");
  return {
    root,
    neocordDir,
    manifest: join(neocordDir, "manifest.ts"),
    types: join(neocordDir, "types.d.ts"),
    entriesDir: join(neocordDir, "entries"),
    buildDir: join(neocordDir, "build"),
    buildInputs: join(neocordDir, "build", "inputs.json"),
    devDir: join(neocordDir, "dev"),
    cacheDir: join(neocordDir, "cache"),
    deployState: join(neocordDir, "deploy.json"),
    devDeployState: join(neocordDir, "deploy.dev.json"),
    tsconfig: join(root, "tsconfig.json"),
  };
}

export function toPosix(path: string): string {
  return path.split(sep).join("/").replaceAll("\\", "/");
}

export function relativePosix(from: string, to: string): string {
  return toPosix(relative(from, to));
}

export function compareStrings(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

export function findConfigFile(directory: string): string | null {
  for (const name of CONFIG_FILE_NAMES) {
    const candidate = join(directory, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function resolveCwd(cwd: string | undefined): string {
  const directory = resolve(cwd ?? process.cwd());
  if (!existsSync(directory) || !statSync(directory).isDirectory()) {
    throw new CliError(`The directory "${directory}" does not exist.`);
  }
  return directory;
}

export function locateProject(start: string): ProjectLocation | null {
  let directory = start;
  while (true) {
    const configFile = findConfigFile(directory);
    if (configFile) return { root: directory, configFile };
    const parent = dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export function findProjectRoot(cwd?: string): ProjectLocation {
  const start = resolveCwd(cwd);
  const location = locateProject(start);
  if (location) return location;
  throw new CliError(`No neocord.config file found in "${start}" or any parent directory.`, {
    hint: "Run this inside a neocord project, pass --cwd <dir>, or start a new one with: bun create neocord",
  });
}

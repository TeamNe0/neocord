import { readdir, stat } from "node:fs/promises";
import { builtinModules } from "node:module";
import { basename, resolve } from "node:path";

const MAX_NAME_LENGTH = 214;
const SCOPED_NAME_PATTERN = /^@([^/]+)\/([^/]+)$/;
const FORBIDDEN_NAMES = new Set(["node_modules", "favicon.ico"]);
const IGNORED_ENTRIES = new Set([".git"]);

export function validatePackageName(name: string): string | undefined {
  if (name.length === 0) return "The project name cannot be empty.";
  if (name.length > MAX_NAME_LENGTH) return `The project name cannot be longer than ${MAX_NAME_LENGTH} characters.`;
  if (name !== name.trim()) return "The project name cannot start or end with spaces.";
  if (name !== name.toLowerCase()) return "The project name must be lowercase.";
  if (FORBIDDEN_NAMES.has(name)) return `"${name}" is a reserved name.`;
  if (builtinModules.includes(name)) return `"${name}" is the name of a Node.js core module.`;

  const scoped = SCOPED_NAME_PATTERN.exec(name);
  const parts = scoped ? [scoped[1] ?? "", scoped[2] ?? ""] : [name];

  for (const part of parts) {
    if (part.startsWith(".") || part.startsWith("_")) return "The project name cannot start with a dot or an underscore.";
    if (/[~'!()*]/.test(part)) return "The project name cannot contain any of ~ ' ! ( ) *.";
    if (encodeURIComponent(part) !== part) return "The project name can only contain URL-safe characters.";
  }
  return undefined;
}

export interface ProjectTarget {
  packageName: string;
  targetDir: string;
}

export function resolveProjectTarget(input: string, cwd: string): ProjectTarget {
  const normalized = input.trim().replaceAll("\\", "/");
  const trimmed = normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;

  if (trimmed === "") return { packageName: "", targetDir: resolve(cwd) };
  if (trimmed === ".") return { packageName: basename(resolve(cwd)), targetDir: resolve(cwd) };

  const segments = trimmed.split("/");
  const scopeIndex = segments.findIndex((segment) => segment.startsWith("@"));
  if (scopeIndex !== -1 && scopeIndex === segments.length - 2) {
    const directory = [...segments.slice(0, scopeIndex), segments[scopeIndex + 1] ?? ""].join("/");
    return { packageName: segments.slice(scopeIndex).join("/"), targetDir: resolve(cwd, directory) };
  }

  const targetDir = resolve(cwd, trimmed);
  return { packageName: basename(targetDir), targetDir };
}

export type DirectoryState = "missing" | "empty" | "non-empty" | "not-a-directory";

export async function inspectDirectory(path: string): Promise<DirectoryState> {
  const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return "missing";
  if (!info.isDirectory()) return "not-a-directory";
  const entries = await readdir(path);
  return entries.every((entry) => IGNORED_ENTRIES.has(entry)) ? "empty" : "non-empty";
}

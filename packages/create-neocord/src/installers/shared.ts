import { appendFile, cp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ProjectOptions } from "../options.ts";
import { type AvailableDependency, resolveVersion } from "../versions.ts";

export interface PackageJsonDraft {
  name: string;
  version: string;
  private: true;
  type: "module";
  scripts: Record<string, string>;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  engines: Record<string, string>;
}

export interface InstallerContext {
  options: ProjectOptions;
  templateDir: string;
  packageJson: PackageJsonDraft;
  versionOverrides: Readonly<Record<string, string>>;
  databaseReadme: string;
}

export type Installer = (context: InstallerContext) => Promise<void>;

export function addDependencies(context: InstallerContext, names: readonly AvailableDependency[]): void {
  for (const name of names) {
    context.packageJson.dependencies[name] = resolveVersion(name, context.versionOverrides);
  }
}

export function addDevDependencies(context: InstallerContext, names: readonly AvailableDependency[]): void {
  for (const name of names) {
    context.packageJson.devDependencies[name] = resolveVersion(name, context.versionOverrides);
  }
}

export async function copyTemplate(context: InstallerContext, relativeSource: string): Promise<void> {
  await cp(join(context.templateDir, relativeSource), context.options.targetDir, { recursive: true, force: true });
}

export async function appendLines(context: InstallerContext, relativeFile: string, lines: readonly string[]): Promise<void> {
  await appendFile(join(context.options.targetDir, relativeFile), `${lines.join("\n")}\n`);
}

export async function replaceInFile(
  context: InstallerContext,
  relativeFile: string,
  search: string,
  replacement: string,
): Promise<void> {
  const path = join(context.options.targetDir, relativeFile);
  const content = await readFile(path, "utf8");
  if (!content.includes(search)) throw new Error(`Could not find "${search}" in ${relativeFile}.`);
  await writeFile(path, content.replace(search, () => replacement));
}

export function requireDialect(context: InstallerContext): NonNullable<ProjectOptions["dialect"]> {
  const { database, dialect } = context.options;
  if (!dialect) throw new Error(`The ${database} installer needs a dialect.`);
  return dialect;
}

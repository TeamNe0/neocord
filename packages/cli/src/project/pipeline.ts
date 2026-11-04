import { existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { CliError } from "../errors.ts";
import type { Ui } from "../ui.ts";
import { bundleEntries, type BundleOutput } from "./bundle.ts";
import { generate, type GenerateResult } from "./codegen.ts";
import { loadConfig, type CliConfig } from "./config.ts";
import { applyEnv, loadEnvFiles, type EnvMode } from "./env.ts";
import { findProjectRoot, projectPaths, type EntryName, type ProjectPaths } from "./paths.ts";
import { resolveRuntime, type ResolvedRuntime } from "./runtime.ts";
import { ProjectIssuesError, scanProject, type ProjectScan } from "./scan.ts";
import { runTaggedProcess, type CapturedResult } from "./spawn.ts";

export const PRODUCTION_ENTRIES: readonly EntryName[] = ["shard", "manager", "deploy"];

export interface Project {
  root: string;
  configFile: string;
  paths: ProjectPaths;
  env: Record<string, string>;
  envFiles: string[];
  config: CliConfig;
  runtime: ResolvedRuntime;
}

export interface OpenProjectOptions {
  cwd?: string | undefined;
  mode: EnvMode;
  skipEnvValidation?: boolean;
}

export interface ValidationIssue {
  severity: "error" | "warning";
  file: string;
  message: string;
}

export interface ValidationOutcome {
  issues: ValidationIssue[];
  commandCount: number;
}

export interface DeployOptions {
  guildId?: string | undefined;
  force?: boolean | undefined;
  dryRun?: boolean | undefined;
  clear?: boolean | undefined;
}

export interface DeployResult {
  status: "deployed" | "unchanged" | "dry-run" | "cleared";
  scope: "global" | "guild";
  guildId?: string;
  commandCount: number;
  hash: string;
  commands: unknown[];
}

export async function openProject(options: OpenProjectOptions): Promise<Project> {
  const { root, configFile } = findProjectRoot(options.cwd);
  const loaded = loadEnvFiles({
    root,
    mode: options.mode,
    env: process.env,
    skipValidation: options.skipEnvValidation ?? false,
  });
  applyEnv(process.env, loaded.env);
  const { config } = await loadConfig({ root, configFile });
  return {
    root,
    configFile,
    paths: projectPaths(root),
    env: loaded.env,
    envFiles: loaded.files,
    config,
    runtime: resolveRuntime(config.runtime),
  };
}

export function scanConfigured(root: string, config: CliConfig): Promise<ProjectScan> {
  return scanProject({ root, sourceDir: config.sourceDir, featuresDir: config.featuresDir });
}

export function assertNoIssues(scan: ProjectScan): void {
  if (scan.issues.length > 0) throw new ProjectIssuesError(scan.issues);
}

export async function syncProject(project: Project): Promise<{ scan: ProjectScan; generated: GenerateResult }> {
  const scan = await scanConfigured(project.root, project.config);
  const generated = await generate(scan, { configFile: project.configFile });
  return { scan, generated };
}

function formatValidationIssue(issue: ValidationIssue): string {
  return issue.file ? `${issue.file}: ${issue.message}` : issue.message;
}

export async function runValidation(project: Project, ui: Ui): Promise<ValidationOutcome> {
  const bundle = await bundleEntries({
    root: project.root,
    entries: ["validate"],
    outDir: project.paths.cacheDir,
    extension: ".mjs",
  });
  const file = bundle.outputs[0]?.file ?? join(project.paths.cacheDir, "validate.mjs");
  const run = await runTaggedProcess<ValidationOutcome>(
    {
      command: project.runtime.command,
      args: [...project.runtime.args, file],
      cwd: project.root,
      env: project.env,
    },
    "validate",
  );
  if (run.result === null || run.code !== 0) {
    throw new CliError(`Validation could not run (exit code ${run.code}).`, {
      hint: "A route module probably threw while loading. The error is printed above.",
    });
  }

  const errors = run.result.issues.filter((issue) => issue.severity === "error");
  for (const issue of run.result.issues) {
    if (issue.severity === "warning") ui.warn(formatValidationIssue(issue));
  }
  if (errors.length > 0) {
    throw new CliError(`Validation found ${errors.length} error${errors.length === 1 ? "" : "s"}.`, {
      details: errors.map(formatValidationIssue),
    });
  }
  return run.result;
}

export interface BuildProjectOptions {
  validate: boolean;
}

export interface BuildOutcome {
  scan: ProjectScan;
  outputs: BundleOutput[];
  validation: ValidationOutcome | null;
}

export async function buildProject(project: Project, ui: Ui, options: BuildProjectOptions): Promise<BuildOutcome> {
  const { scan } = await syncProject(project);
  assertNoIssues(scan);
  const bundle = await bundleEntries({
    root: project.root,
    entries: PRODUCTION_ENTRIES,
    outDir: project.paths.buildDir,
  });
  for (const warning of bundle.warnings) ui.warn(warning);
  const validation = options.validate ? await runValidation(project, ui) : null;
  return { scan, outputs: bundle.outputs, validation };
}

async function newestMtimeIn(directory: string): Promise<number> {
  let newest = 0;
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
    newest = (await stat(directory)).mtimeMs;
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const path = join(directory, entry.name);
    const mtime = entry.isDirectory()
      ? await newestMtimeIn(path)
      : await stat(path).then((info) => info.mtimeMs, () => 0);
    if (mtime > newest) newest = mtime;
  }
  return newest;
}

export async function isBuildStale(project: Pick<Project, "root" | "configFile" | "config" | "paths">, artifact: string): Promise<boolean> {
  const built = await stat(artifact).then((info) => info.mtimeMs, () => null);
  if (built === null) return true;
  const inputs = await Promise.all([
    newestMtimeIn(join(project.root, project.config.sourceDir)),
    newestMtimeIn(join(project.root, project.config.featuresDir)),
    stat(project.configFile).then((info) => info.mtimeMs, () => 0),
    stat(project.paths.tsconfig).then((info) => info.mtimeMs, () => 0),
  ]);
  return inputs.some((mtime) => mtime > built);
}

export function deployArtifact(paths: ProjectPaths): string {
  return join(paths.buildDir, "deploy.js");
}

export function hasArtifact(file: string): boolean {
  return existsSync(file);
}

export interface RunDeployOptions {
  file: string;
  stateFile: string;
  options: DeployOptions;
  env: Record<string, string>;
  root: string;
  runtime: ResolvedRuntime;
  spawn?: Parameters<typeof runTaggedProcess>[0]["spawn"];
}

export function runDeployEntry(input: RunDeployOptions): Promise<CapturedResult<{ result: DeployResult }>> {
  const deployOptions = Object.fromEntries(
    Object.entries({ ...input.options, stateFile: input.stateFile }).filter(([, value]) => value !== undefined && value !== false),
  );
  return runTaggedProcess<{ result: DeployResult }>(
    {
      command: input.runtime.command,
      args: [...input.runtime.args, input.file],
      cwd: input.root,
      env: { ...input.env, NEOCORD_DEPLOY_OPTIONS: JSON.stringify(deployOptions) },
      ...(input.spawn ? { spawn: input.spawn } : {}),
    },
    "deploy",
  );
}

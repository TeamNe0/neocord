import { rm } from "node:fs/promises";
import { CliError } from "../errors.ts";
import {
  buildProject,
  deployArtifact,
  isBuildStale,
  openProject,
  runDeployEntry,
  type DeployResult,
  type Project,
} from "../project/pipeline.ts";
import type { TreeNode, Ui } from "../ui.ts";

export interface DeployCommandOptions {
  cwd?: string | undefined;
  guild?: string | undefined;
  force: boolean;
  dryRun: boolean;
  clear?: boolean | undefined;
}

const SUBCOMMAND = 1;
const SUBCOMMAND_GROUP = 2;
const COMMAND_TYPE_SUFFIX = new Map<unknown, string>([
  [2, " (user)"],
  [3, " (message)"],
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function childNodes(options: unknown): TreeNode[] {
  if (!Array.isArray(options)) return [];
  const nodes: TreeNode[] = [];
  for (const option of options as unknown[]) {
    const record = asRecord(option);
    if (record === null || typeof record.name !== "string") continue;
    if (record.type === SUBCOMMAND || record.type === SUBCOMMAND_GROUP) {
      nodes.push({ label: record.name, children: childNodes(record.options) });
    } else {
      nodes.push({ label: `<${record.name}>` });
    }
  }
  return nodes;
}

export function commandTree(commands: readonly unknown[]): TreeNode[] {
  const nodes: TreeNode[] = [];
  for (const command of commands) {
    const record = asRecord(command);
    if (record === null || typeof record.name !== "string") continue;
    const suffix = COMMAND_TYPE_SUFFIX.get(record.type);
    nodes.push(
      suffix === undefined
        ? { label: `/${record.name}`, children: childNodes(record.options) }
        : { label: `${record.name}${suffix}` },
    );
  }
  return nodes;
}

function scopeLabel(result: DeployResult): string {
  return result.scope === "guild" ? `guild ${result.guildId ?? ""}`.trim() : "global scope";
}

export function renderDeployResult(result: DeployResult, ui: Ui, clear = false): void {
  const count = `${result.commandCount} command${result.commandCount === 1 ? "" : "s"}`;
  if (result.status === "cleared") {
    ui.success(`Removed every command from ${scopeLabel(result)}.`);
  } else if (result.status === "dry-run" && clear) {
    ui.info(`Dry run: would remove every command from ${scopeLabel(result)}.`);
  } else if (result.status === "dry-run") {
    ui.info(`Dry run: would deploy ${count} to ${scopeLabel(result)} (hash ${result.hash}).`);
    ui.tree(commandTree(result.commands));
  } else if (result.status === "unchanged") {
    ui.success(`${count} in ${scopeLabel(result)} already up to date (hash ${result.hash}).`);
  } else {
    ui.success(`Deployed ${count} to ${scopeLabel(result)} (hash ${result.hash}).`);
  }
}

async function forgetDevDeployState(project: Project): Promise<void> {
  await rm(project.paths.devDeployState, { force: true });
}

export async function executeDeploy(project: Project, options: DeployCommandOptions, ui: Ui): Promise<number> {
  const run = await runDeployEntry({
    file: deployArtifact(project.paths),
    stateFile: project.paths.deployState,
    options: { guildId: options.guild, force: options.force, dryRun: options.dryRun, clear: options.clear },
    env: project.env,
    root: project.root,
    runtime: project.runtime,
  });
  if (run.code !== 0) throw new CliError("Deploy failed.", { exitCode: run.code });
  if (run.result === null) throw new CliError("The deploy process exited without reporting a result.");
  renderDeployResult(run.result.result, ui, options.clear === true);
  if (run.result.result.status === "cleared") await forgetDevDeployState(project);
  return 0;
}

export async function runDeploy(options: DeployCommandOptions, ui: Ui): Promise<number> {
  const project = await openProject({ cwd: options.cwd, mode: "production", skipEnvValidation: options.dryRun });
  if (await isBuildStale(project, deployArtifact(project.paths))) {
    ui.info("The build is missing or out of date. Building first.");
    await buildProject(project, ui, { validate: true });
  }
  return executeDeploy(project, options, ui);
}

import { join } from "node:path";
import { CliError } from "../errors.ts";
import { findProjectRoot, projectPaths } from "../project/paths.ts";
import { deployArtifact, hasArtifact, isBuildStale, openProject } from "../project/pipeline.ts";
import { runProcess } from "../project/spawn.ts";
import type { Ui } from "../ui.ts";
import { executeDeploy } from "./deploy.ts";

export interface StartCommandOptions {
  cwd?: string | undefined;
  shards?: number | undefined;
  deploy: boolean;
}

export async function runStart(options: StartCommandOptions, ui: Ui): Promise<number> {
  const { root } = findProjectRoot(options.cwd);
  const manager = join(projectPaths(root).buildDir, "manager.js");
  if (!hasArtifact(manager)) {
    throw new CliError("Run neocord build first.", { hint: `${manager} does not exist.` });
  }

  const project = await openProject({ cwd: root, mode: "production" });

  if (await isBuildStale(project, manager)) {
    ui.warn(
      "The production bundle looks out of date: project files changed after it was built, so this may run old code. Run neocord build to update it. Starting anyway, because file times can also differ after a checkout or deploy.",
    );
  }

  if (options.deploy || project.config.deploy.mode === "auto") {
    if (!hasArtifact(deployArtifact(project.paths))) {
      throw new CliError("Run neocord build first.", { hint: `${deployArtifact(project.paths)} does not exist.` });
    }
    await executeDeploy(project, { force: false, dryRun: false }, ui);
  }

  const { code } = await runProcess({
    command: project.runtime.command,
    args: [...project.runtime.args, manager],
    cwd: project.root,
    env: {
      ...project.env,
      ...(options.shards === undefined ? {} : { NEOCORD_SHARD_COUNT: String(options.shards) }),
    },
  });
  return code;
}

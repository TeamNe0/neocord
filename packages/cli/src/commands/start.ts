import { join } from "node:path";
import { CliError } from "../errors.ts";
import { findProjectRoot, projectPaths } from "../project/paths.ts";
import { deployArtifact, hasArtifact, openProject } from "../project/pipeline.ts";
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

import { relativePosix } from "../project/paths.ts";
import { openProject, syncProject } from "../project/pipeline.ts";
import { ProjectIssuesError } from "../project/scan.ts";
import type { Ui } from "../ui.ts";

export interface TypegenCommandOptions {
  cwd?: string | undefined;
}

export async function runTypegen(options: TypegenCommandOptions, ui: Ui): Promise<number> {
  const project = await openProject({ cwd: options.cwd, mode: "development", skipEnvValidation: true });
  const { scan, generated } = await syncProject(project);
  const target = relativePosix(project.root, project.paths.neocordDir);
  if (generated.changed.length === 0) ui.success(`${target} is already up to date.`);
  else ui.success(`Wrote ${generated.changed.length} files to ${target}.`);
  if (scan.issues.length > 0) throw new ProjectIssuesError(scan.issues);
  return 0;
}

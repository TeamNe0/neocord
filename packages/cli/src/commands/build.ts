import type { RouteKind } from "@teamneo/neocord-routing";
import { relativePosix } from "../project/paths.ts";
import { buildProject, openProject, syncProject } from "../project/pipeline.ts";
import type { ScannedRoute } from "../project/scan.ts";
import { formatBytes, type Ui } from "../ui.ts";
import { CliError } from "../errors.ts";
import { runTypecheck } from "./tools.ts";

export interface BuildCommandOptions {
  cwd?: string | undefined;
  validate: boolean;
  typecheck: boolean;
}

export const ROUTE_KIND_ORDER: readonly RouteKind[] = [
  "command",
  "user-command",
  "message-command",
  "button",
  "select",
  "modal",
  "event",
  "task",
];

export function routeSummaryRows(routes: readonly ScannedRoute[]): { headers: string[]; rows: string[][] } {
  const kinds = ROUTE_KIND_ORDER.filter((kind) => routes.some((route) => route.kind === kind));
  const features = [...new Set(routes.map((route) => route.feature))].sort();
  const count = (list: readonly ScannedRoute[], kind: RouteKind): string =>
    String(list.filter((route) => route.kind === kind).length);
  const rows = features.map((feature) => {
    const inFeature = routes.filter((route) => route.feature === feature);
    return [feature, ...kinds.map((kind) => count(inFeature, kind)), String(inFeature.length)];
  });
  rows.push(["total", ...kinds.map((kind) => count(routes, kind)), String(routes.length)]);
  return { headers: ["feature", ...kinds, "routes"], rows };
}

export async function runBuild(options: BuildCommandOptions, ui: Ui): Promise<number> {
  const project = await openProject({ cwd: options.cwd, mode: "production", skipEnvValidation: true });

  if (options.typecheck) {
    await syncProject(project);
    const code = await runTypecheck({ root: project.root, env: project.env });
    if (code !== 0) throw new CliError("Type checking failed.", { exitCode: code });
  }

  const outcome = await buildProject(project, ui, { validate: options.validate });

  const summary = routeSummaryRows(outcome.scan.routes);
  ui.table(summary.headers, summary.rows);
  ui.print();
  ui.table(
    ["bundle", "size"],
    outcome.outputs.map((output) => [relativePosix(project.root, output.file), formatBytes(output.bytes)]),
  );
  ui.print();
  ui.success(`Built ${outcome.scan.routes.length} routes into ${relativePosix(project.root, project.paths.buildDir)}.`);
  return 0;
}

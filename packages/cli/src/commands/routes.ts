import { compareStrings } from "../project/paths.ts";
import { openProject, scanConfigured } from "../project/pipeline.ts";
import { ProjectIssuesError, type ScannedRoute } from "../project/scan.ts";
import type { Ui } from "../ui.ts";
import { ROUTE_KIND_ORDER } from "./build.ts";

export interface RoutesCommandOptions {
  cwd?: string | undefined;
  json: boolean;
}

function sortForDisplay(routes: readonly ScannedRoute[]): ScannedRoute[] {
  return [...routes].sort(
    (left, right) =>
      ROUTE_KIND_ORDER.indexOf(left.kind) - ROUTE_KIND_ORDER.indexOf(right.kind) ||
      compareStrings(left.id, right.id) ||
      compareStrings(left.file, right.file),
  );
}

export async function runRoutes(options: RoutesCommandOptions, ui: Ui): Promise<number> {
  const project = await openProject({ cwd: options.cwd, mode: "development", skipEnvValidation: true });
  const scan = await scanConfigured(project.root, project.config);
  const routes = sortForDisplay(scan.routes);

  if (options.json) {
    ui.print(
      JSON.stringify(
        {
          routes: routes.map((route) => ({
            kind: route.kind,
            id: route.id,
            feature: route.feature,
            file: route.file,
            segments: route.segments,
            middleware: route.middleware,
            layouts: route.layouts,
            error: route.error,
            loading: route.loading,
          })),
          issues: scan.issues,
        },
        null,
        2,
      ),
    );
    return scan.issues.length > 0 ? 1 : 0;
  }

  if (routes.length === 0) ui.info("No routes found.");
  else ui.table(["kind", "id", "feature", "file"], routes.map((route) => [route.kind, route.id, route.feature, route.file]));
  if (scan.issues.length > 0) throw new ProjectIssuesError(scan.issues);
  return 0;
}

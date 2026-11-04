import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
  classifyFile,
  COMMAND_SEGMENT_PATTERN,
  createRouter,
  MAX_COMMAND_DEPTH,
  normalizePath,
  RouteConflictError,
  type RouteKind,
  type SegmentKind,
} from "@teamneo/neocord-routing";
import { CliError } from "../errors.ts";
import { compareStrings } from "./paths.ts";

export interface ProjectIssue {
  file: string;
  message: string;
}

export interface ScannedRoute {
  kind: RouteKind;
  id: string;
  feature: string;
  file: string;
  segments: string[];
  scopes: string[];
  middleware: string[];
  layouts: string[];
  error: string | null;
  loading: string | null;
}

export interface ScannedGroup {
  feature: string;
  segments: string[];
  scope: string;
  file: string;
}

export interface ScannedSegment {
  kind: SegmentKind;
  feature: string | null;
  scope: string;
  file: string;
}

export interface ScannedFeature {
  name: string;
  file: string | null;
}

export interface ProjectScan {
  root: string;
  sourceDir: string;
  featuresDir: string;
  context: string | null;
  env: string | null;
  features: ScannedFeature[];
  groups: ScannedGroup[];
  segments: ScannedSegment[];
  routes: ScannedRoute[];
  issues: ProjectIssue[];
}

export interface ScanOptions {
  root: string;
  sourceDir?: string;
  featuresDir?: string;
}

export class ProjectIssuesError extends CliError {
  override readonly name: string = "ProjectIssuesError";
  readonly issues: readonly ProjectIssue[];

  constructor(issues: readonly ProjectIssue[]) {
    super(`Found ${issues.length} problem${issues.length === 1 ? "" : "s"} in the project files.`, {
      details: issues.map((issue) => `${issue.file}: ${issue.message}`),
    });
    this.issues = issues;
  }
}

const COLLIDING_KINDS: readonly RouteKind[] = ["command", "user-command", "message-command", "button", "select", "modal", "task"];
const ROUTER_KINDS: readonly RouteKind[] = ["button", "select", "modal"];
const SKIPPED_DIRECTORIES = new Set(["node_modules"]);

async function walkDirectory(root: string, relativeDir: string, into: Set<string>): Promise<void> {
  let entries;
  try {
    entries = await readdir(join(root, relativeDir), { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const path = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith(".")) {
        await walkDirectory(root, path, into);
      }
    } else if (entry.isFile() || entry.isSymbolicLink()) {
      if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) into.add(path);
    }
  }
}

function groupBy<T>(items: readonly T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    const existing = groups.get(id);
    if (existing) existing.push(item);
    else groups.set(id, [item]);
  }
  return groups;
}

function reportDuplicates(files: readonly string[], describe: string, issues: ProjectIssue[]): void {
  const [first, ...others] = files;
  if (first === undefined) return;
  for (const file of others) {
    issues.push({ file, message: `${describe} is already defined by "${first}".` });
  }
}

function checkRouteCollisions(routes: readonly ScannedRoute[], issues: ProjectIssue[]): void {
  for (const kind of COLLIDING_KINDS) {
    const ofKind = routes.filter((route) => route.kind === kind);
    for (const [id, matches] of groupBy(ofKind, (route) => route.id)) {
      reportDuplicates(matches.map((route) => route.file), `The ${kind} route "${id}"`, issues);
    }
  }
  for (const kind of ROUTER_KINDS) {
    const router = createRouter<string>();
    const unique = [...groupBy(routes.filter((route) => route.kind === kind), (route) => route.id).values()];
    for (const [route] of unique) {
      if (!route) continue;
      try {
        router.add(route.id, route.file);
      } catch (error) {
        if (!(error instanceof RouteConflictError)) throw error;
        issues.push({ file: route.file, message: error.message });
      }
    }
  }
}

function checkCommandLayout(routes: readonly ScannedRoute[], groups: readonly ScannedGroup[], issues: ProjectIssue[]): void {
  const commands = routes.filter((route) => route.kind === "command");
  for (const command of commands) {
    if (command.segments.length > MAX_COMMAND_DEPTH) {
      issues.push({
        file: command.file,
        message: `Slash commands can be at most ${MAX_COMMAND_DEPTH} levels deep, "/${command.id}" has ${command.segments.length}.`,
      });
    }
    const invalid = command.segments.find((segment) => !COMMAND_SEGMENT_PATTERN.test(segment));
    if (invalid !== undefined) {
      issues.push({ file: command.file, message: `"${invalid}" is not a valid slash command name.` });
    }
    const nested = commands.find(
      (other) =>
        other.segments.length > command.segments.length &&
        command.segments.every((segment, index) => other.segments[index] === segment),
    );
    if (nested) {
      issues.push({
        file: command.file,
        message: `"/${command.id}" cannot be both a command and the parent of "/${nested.id}" (${nested.file}).`,
      });
    }
    const group = groups.find((item) => item.segments.join(" ") === command.id);
    if (group) {
      issues.push({ file: group.file, message: `"/${command.id}" cannot be both a command and a group (${command.file}).` });
    }
  }
  for (const group of groups) {
    if (group.segments.length >= MAX_COMMAND_DEPTH) {
      issues.push({
        file: group.file,
        message: `Command groups can be at most ${MAX_COMMAND_DEPTH - 1} levels deep, "${group.segments.join(" ")}" has ${group.segments.length}.`,
      });
    }
  }
  for (const [id, matches] of groupBy(groups, (group) => group.segments.join(" "))) {
    reportDuplicates(matches.map((group) => group.file), `The command group "${id}"`, issues);
  }
}

function checkSingletons(
  segments: readonly ScannedSegment[],
  contexts: readonly string[],
  featureFiles: ReadonlyMap<string, string[]>,
  issues: ProjectIssue[],
): void {
  for (const [key, matches] of groupBy(segments, (segment) => `${segment.scope}\0${segment.kind}`)) {
    const [scope = "", kind = ""] = key.split("\0");
    reportDuplicates(matches.map((segment) => segment.file), `The ${kind} for "${scope}"`, issues);
  }
  reportDuplicates(contexts, "The app context", issues);
  for (const [name, files] of featureFiles) {
    reportDuplicates(files, `The definition of feature "${name}"`, issues);
  }
}

function resolveChain(
  scopes: readonly string[],
  segments: ReadonlyMap<string, ScannedSegment>,
  kind: SegmentKind,
): string[] {
  const chain: string[] = [];
  for (const scope of scopes) {
    const segment = segments.get(`${scope}\0${kind}`);
    if (segment) chain.push(segment.file);
  }
  return chain;
}

export async function scanProject(options: ScanOptions): Promise<ProjectScan> {
  const root = options.root;
  const sourceDir = normalizePath(options.sourceDir ?? "src").replace(/\/+$/, "");
  const featuresDir = normalizePath(options.featuresDir ?? `${sourceDir}/features`).replace(/\/+$/, "");

  const found = new Set<string>();
  await walkDirectory(root, sourceDir, found);
  if (featuresDir !== sourceDir && !featuresDir.startsWith(`${sourceDir}/`)) {
    await walkDirectory(root, featuresDir, found);
  }
  const files = [...found].sort(compareStrings);

  const issues: ProjectIssue[] = [];
  const contexts: string[] = [];
  const envs: string[] = [];
  const pendingRoutes: Omit<ScannedRoute, "middleware" | "layouts" | "error" | "loading">[] = [];
  const groups: ScannedGroup[] = [];
  const segments: ScannedSegment[] = [];
  const featureNames = new Set<string>();
  const featureFiles = new Map<string, string[]>();

  for (const file of files) {
    const classified = classifyFile(file, { sourceDir, featuresDir });
    switch (classified.type) {
      case "route":
        featureNames.add(classified.feature);
        pendingRoutes.push({
          kind: classified.kind,
          id: classified.routeId,
          feature: classified.feature,
          file,
          segments: classified.segments,
          scopes: classified.scopes,
        });
        break;
      case "segment":
        if (classified.feature !== null) featureNames.add(classified.feature);
        segments.push({ kind: classified.kind, feature: classified.feature, scope: classified.scope, file });
        break;
      case "group":
        featureNames.add(classified.feature);
        groups.push({ feature: classified.feature, segments: classified.segments, scope: classified.scope, file });
        break;
      case "feature": {
        featureNames.add(classified.feature);
        const known = featureFiles.get(classified.feature);
        if (known) known.push(file);
        else featureFiles.set(classified.feature, [file]);
        break;
      }
      case "context":
        contexts.push(file);
        break;
      case "env":
        envs.push(file);
        break;
      case "invalid":
        issues.push({ file, message: classified.reason });
        break;
      case "private":
      case "outside":
        break;
    }
  }

  const segmentIndex = new Map<string, ScannedSegment>();
  for (const segment of segments) {
    const key = `${segment.scope}\0${segment.kind}`;
    if (!segmentIndex.has(key)) segmentIndex.set(key, segment);
  }

  const routes: ScannedRoute[] = pendingRoutes.map((route) => {
    const chain = [sourceDir, ...route.scopes];
    return {
      ...route,
      middleware: resolveChain(chain, segmentIndex, "middleware"),
      layouts: resolveChain(chain, segmentIndex, "layout"),
      error: resolveChain(chain, segmentIndex, "error").at(-1) ?? null,
      loading: resolveChain(chain, segmentIndex, "loading").at(-1) ?? null,
    };
  });

  checkRouteCollisions(routes, issues);
  checkCommandLayout(routes, groups, issues);
  checkSingletons(segments, contexts, featureFiles, issues);

  issues.sort((left, right) => compareStrings(left.file, right.file) || compareStrings(left.message, right.message));

  return {
    root,
    sourceDir,
    featuresDir,
    context: contexts[0] ?? null,
    env: envs[0] ?? null,
    features: [...featureNames]
      .sort(compareStrings)
      .map((name) => ({ name, file: featureFiles.get(name)?.[0] ?? null })),
    groups,
    segments,
    routes,
    issues,
  };
}

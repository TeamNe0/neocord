export type RouteKind =
  | "command"
  | "user-command"
  | "message-command"
  | "button"
  | "select"
  | "modal"
  | "event"
  | "task";

export type SegmentKind = "middleware" | "layout" | "error" | "loading";

export const ROUTE_DIRECTORIES = {
  commands: "command",
  "user-commands": "user-command",
  "message-commands": "message-command",
  buttons: "button",
  selects: "select",
  modals: "modal",
  events: "event",
  tasks: "task",
} as const satisfies Record<string, RouteKind>;

export type RouteDirectory = keyof typeof ROUTE_DIRECTORIES;

export const ROUTE_FILE_NAMES = {
  command: "command",
  "user-command": "command",
  "message-command": "command",
  button: "button",
  select: "select",
  modal: "modal",
} as const;

export const DEFINE_HELPERS = {
  command: "defineCommand",
  "user-command": "defineUserCommand",
  "message-command": "defineMessageCommand",
  button: "defineButton",
  select: "defineSelect",
  modal: "defineModal",
  event: "defineEvent",
  task: "defineTask",
  group: "defineGroup",
  feature: "defineFeature",
  context: "defineContext",
  middleware: "defineMiddleware",
} as const;

export const SEGMENT_FILE_NAMES = ["middleware", "layout", "error", "loading"] as const satisfies readonly SegmentKind[];

export const SOURCE_EXTENSIONS = [".ts", ".tsx"] as const;

export const COMMAND_SEGMENT_PATTERN = /^[-_'\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

export const MAX_COMMAND_DEPTH = 3;

export interface ClassifyOptions {
  sourceDir?: string;
  featuresDir?: string;
}

export interface RouteFile {
  type: "route";
  kind: RouteKind;
  feature: string;
  routeId: string;
  segments: string[];
  scopes: string[];
}

export interface SegmentFile {
  type: "segment";
  kind: SegmentKind;
  feature: string | null;
  scope: string;
}

export interface GroupFile {
  type: "group";
  feature: string;
  segments: string[];
  scope: string;
}

export interface FeatureFile {
  type: "feature";
  feature: string;
}

export interface ContextFile {
  type: "context";
}

export interface InstrumentationFile {
  type: "env";
}

export interface PrivateFile {
  type: "private";
}

export interface InvalidFile {
  type: "invalid";
  reason: string;
}

export interface OutsideFile {
  type: "outside";
}

export type FileClassification =
  | RouteFile
  | SegmentFile
  | GroupFile
  | FeatureFile
  | ContextFile
  | InstrumentationFile
  | PrivateFile
  | InvalidFile
  | OutsideFile;

export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function splitExtension(fileName: string): { base: string; extension: string } | null {
  for (const extension of SOURCE_EXTENSIONS) {
    if (fileName.endsWith(extension)) {
      return { base: fileName.slice(0, -extension.length), extension };
    }
  }
  return null;
}

function isRouteGroup(segment: string): boolean {
  return segment.startsWith("(") && segment.endsWith(")");
}

function isPrivate(segment: string): boolean {
  return segment.startsWith("_");
}

function isSegmentFileName(base: string): base is SegmentKind {
  return (SEGMENT_FILE_NAMES as readonly string[]).includes(base);
}

function isRouteDirectory(segment: string): segment is RouteDirectory {
  return Object.hasOwn(ROUTE_DIRECTORIES, segment);
}

function isTestFile(fileName: string): boolean {
  return /\.(test|spec)\.tsx?$/.test(fileName);
}

function scopesFor(prefix: string, parts: readonly string[]): string[] {
  const scopes = [prefix];
  for (let index = 1; index <= parts.length; index++) {
    scopes.push(`${prefix}/${parts.slice(0, index).join("/")}`);
  }
  return scopes;
}

function classifyInKindDirectory(
  featuresDir: string,
  feature: string,
  directory: RouteDirectory,
  rest: readonly string[],
): FileClassification {
  const kind = ROUTE_DIRECTORIES[directory];
  const fileName = rest.at(-1);
  if (!fileName) return { type: "invalid", reason: `"${directory}" must contain files.` };
  const parsed = splitExtension(fileName);
  if (!parsed) return { type: "private" };

  const folders = rest.slice(0, -1);
  const segments = folders.filter((segment) => !isRouteGroup(segment));
  const prefix = `${featuresDir}/${feature}/${directory}`;
  const routeScopes = [`${featuresDir}/${feature}`, ...scopesFor(prefix, folders)];

  if (kind === "event" || kind === "task") {
    const named = segments[0] ?? parsed.base;
    if (segments.length > 1) {
      return {
        type: "invalid",
        reason: `"${directory}" files must be "${directory}/<name>.ts" or "${directory}/<name>/<file>.ts".`,
      };
    }
    const routeId = kind === "event" ? named : `${feature}/${named}`;
    return { type: "route", kind, feature, routeId, segments: [named], scopes: routeScopes };
  }

  if (isSegmentFileName(parsed.base)) {
    return { type: "segment", kind: parsed.base, feature, scope: `${prefix}${folders.length ? `/${folders.join("/")}` : ""}` };
  }

  if (kind === "command" && parsed.base === "group") {
    if (segments.length === 0) {
      return { type: "invalid", reason: `"group" files must live in a named folder inside "${directory}".` };
    }
    return { type: "group", feature, segments, scope: `${prefix}/${folders.join("/")}` };
  }

  const expected = ROUTE_FILE_NAMES[kind];
  if (parsed.base !== expected) {
    return {
      type: "invalid",
      reason: `Files in "${directory}" must be named "${expected}.ts" or "${expected}.tsx". Move helpers into a "_private" folder.`,
    };
  }

  if (segments.length === 0) {
    return { type: "invalid", reason: `"${expected}" files must live in a named folder inside "${directory}".` };
  }

  const routeId =
    kind === "command"
      ? segments.join(" ")
      : `${feature}/${segments.join("/")}`;

  return { type: "route", kind, feature, routeId, segments, scopes: routeScopes };
}

export function classifyFile(relativePath: string, options: ClassifyOptions = {}): FileClassification {
  const sourceDir = normalizePath(options.sourceDir ?? "src");
  const featuresDir = normalizePath(options.featuresDir ?? `${sourceDir}/features`);
  const path = normalizePath(relativePath);
  const fileName = path.split("/").at(-1) ?? "";

  if (isTestFile(fileName)) return { type: "outside" };

  if (path.startsWith(`${featuresDir}/`)) {
    const parts = path.slice(featuresDir.length + 1).split("/");
    const feature = parts[0]!;

    if (parts.some(isPrivate)) return { type: "private" };

    if (parts.length === 1) {
      return { type: "invalid", reason: "Files directly inside the features folder must belong to a feature folder." };
    }

    const second = parts[1]!;

    if (parts.length === 2) {
      const parsed = splitExtension(second);
      if (!parsed) return { type: "private" };
      if (parsed.base === "feature") return { type: "feature", feature };
      if (isSegmentFileName(parsed.base)) {
        return { type: "segment", kind: parsed.base, feature, scope: `${featuresDir}/${feature}` };
      }
      return {
        type: "invalid",
        reason: `Unexpected file in feature "${feature}". Move helpers into a "_private" folder.`,
      };
    }

    if (isRouteDirectory(second)) {
      return classifyInKindDirectory(featuresDir, feature, second, parts.slice(2));
    }

    return {
      type: "invalid",
      reason: `Unknown folder "${second}" in feature "${feature}". Expected one of ${Object.keys(ROUTE_DIRECTORIES).join(", ")}, or a "_private" folder.`,
    };
  }

  if (path.startsWith(`${sourceDir}/`)) {
    const rest = path.slice(sourceDir.length + 1);
    if (rest.includes("/")) return { type: "outside" };
    const parsed = splitExtension(rest);
    if (!parsed) return { type: "outside" };
    if (parsed.base === "context") return { type: "context" };
    if (parsed.base === "env") return { type: "env" };
    if (isSegmentFileName(parsed.base)) return { type: "segment", kind: parsed.base, feature: null, scope: sourceDir };
  }

  return { type: "outside" };
}

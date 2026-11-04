import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { compareStrings, projectPaths, relativePosix, type EntryName } from "./paths.ts";
import type { ProjectScan } from "./scan.ts";

export interface GenerateOptions {
  configFile: string;
}

export interface GenerateResult {
  files: string[];
  changed: string[];
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function quoteList(values: readonly string[]): string {
  return `[${values.map(quote).join(", ")}]`;
}

function moduleImportPath(file: string): string {
  return `../${file}`;
}

function collectModuleFiles(scan: ProjectScan): string[] {
  const files = new Set<string>();
  if (scan.context) files.add(scan.context);
  for (const feature of scan.features) if (feature.file) files.add(feature.file);
  for (const group of scan.groups) files.add(group.file);
  for (const segment of scan.segments) files.add(segment.file);
  for (const route of scan.routes) files.add(route.file);
  return [...files].sort(compareStrings);
}

export function renderManifest(scan: ProjectScan): string {
  const files = collectModuleFiles(scan);
  const names = new Map(files.map((file, index) => [file, `m${index}`]));
  const moduleName = (file: string): string => names.get(file) ?? "null";
  const reference = (file: string): string => `{ file: ${quote(file)}, module: ${moduleName(file)} }`;
  const referenceList = (list: readonly string[]): string => `[${list.map(reference).join(", ")}]`;

  const lines = [
    'import type { Manifest } from "neocord/runtime";',
    ...files.map((file, index) => `import * as m${index} from ${quote(moduleImportPath(file))};`),
    "",
    "export const manifest: Manifest = {",
    "  version: 1,",
    `  context: ${scan.context ? moduleName(scan.context) : "null"},`,
  ];

  if (scan.features.length === 0) {
    lines.push("  features: [],");
  } else {
    lines.push("  features: [");
    for (const feature of scan.features) {
      lines.push(`    { name: ${quote(feature.name)}, module: ${feature.file ? moduleName(feature.file) : "null"} },`);
    }
    lines.push("  ],");
  }

  if (scan.groups.length === 0) {
    lines.push("  groups: [],");
  } else {
    lines.push("  groups: [");
    for (const group of scan.groups) {
      lines.push(
        `    { feature: ${quote(group.feature)}, segments: ${quoteList(group.segments)}, file: ${quote(group.file)}, module: ${moduleName(group.file)} },`,
      );
    }
    lines.push("  ],");
  }

  if (scan.routes.length === 0) {
    lines.push("  routes: [],");
  } else {
    lines.push("  routes: [");
    for (const route of scan.routes) {
      lines.push(
        "    {",
        `      kind: ${quote(route.kind)},`,
        `      id: ${quote(route.id)},`,
        `      feature: ${quote(route.feature)},`,
        `      file: ${quote(route.file)},`,
        `      segments: ${quoteList(route.segments)},`,
        `      module: ${moduleName(route.file)},`,
        `      middleware: ${referenceList(route.middleware)},`,
        `      layouts: ${referenceList(route.layouts)},`,
        `      error: ${route.error ? reference(route.error) : "null"},`,
        `      loading: ${route.loading ? reference(route.loading) : "null"},`,
        "    },",
      );
    }
    lines.push("  ],");
  }

  lines.push("};", "");
  return lines.join("\n");
}

function routeUnion(scan: ProjectScan, kind: "button" | "select" | "modal"): string {
  const ids = [...new Set(scan.routes.filter((route) => route.kind === kind).map((route) => route.id))].sort(compareStrings);
  return ids.length === 0 ? "never" : ids.map(quote).join(" | ");
}

export function renderTypes(scan: ProjectScan): string {
  const lines = [
    'declare module "@neocord/react" {',
    "  interface RegisteredRoutes {",
    `    buttons: ${routeUnion(scan, "button")};`,
    `    selects: ${routeUnion(scan, "select")};`,
    `    modals: ${routeUnion(scan, "modal")};`,
    "  }",
    "}",
  ];
  if (scan.context) {
    lines.push(
      'declare module "neocord" {',
      "  interface RegisteredApp {",
      `    context: import("neocord").InferAppContext<typeof import(${quote(moduleImportPath(scan.context))}).default>;`,
      "  }",
      "}",
    );
  }
  lines.push("export {};", "");
  return lines.join("\n");
}

export function renderShardEntry(configImport: string): string {
  return [
    'import { startBot } from "neocord/runtime";',
    `import config from ${quote(configImport)};`,
    'import { manifest } from "../manifest.ts";',
    "",
    "await startBot({ config, manifest });",
    "",
  ].join("\n");
}

export function renderManagerEntry(configImport: string): string {
  return [
    'import { startManager } from "neocord/runtime";',
    `import config from ${quote(configImport)};`,
    "",
    "const shards = Number(process.env.NEOCORD_SHARD_COUNT);",
    "",
    "await startManager({",
    "  config,",
    '  shardFile: new URL("./shard.js", import.meta.url),',
    "  ...(Number.isInteger(shards) && shards > 0 ? { shards } : {}),",
    "});",
    "",
  ].join("\n");
}

export function renderDeployEntry(configImport: string): string {
  return [
    'import { deployCommands } from "neocord/runtime";',
    `import config from ${quote(configImport)};`,
    'import { manifest } from "../manifest.ts";',
    "",
    'const options = JSON.parse(process.env.NEOCORD_DEPLOY_OPTIONS ?? "{}");',
    "",
    "try {",
    "  const result = await deployCommands({ ...options, config, manifest });",
    '  process.stdout.write(`${JSON.stringify({ neocord: "deploy", result })}\\n`, () => process.exit(0));',
    "} catch (error) {",
    "  const message = error instanceof Error ? error.message : String(error);",
    "  process.stderr.write(`${message}\\n`, () => process.exit(1));",
    "}",
    "",
  ].join("\n");
}

export function renderValidateEntry(configImport: string): string {
  return [
    'import { serializeCommands, validateManifest } from "neocord/runtime";',
    `import config from ${quote(configImport)};`,
    'import { manifest } from "../manifest.ts";',
    "",
    "const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));",
    "const issues: { severity: string; file: string; message: string }[] = [];",
    "let commandCount = 0;",
    "",
    "try {",
    "  issues.push(...validateManifest(manifest, config));",
    "} catch (error) {",
    '  issues.push({ severity: "error", file: "", message: describe(error) });',
    "}",
    "",
    "try {",
    "  const commands = serializeCommands(manifest);",
    "  commandCount = Array.isArray(commands) ? commands.length : 0;",
    "} catch (error) {",
    '  issues.push({ severity: "error", file: "", message: describe(error) });',
    "}",
    "",
    'process.stdout.write(`${JSON.stringify({ neocord: "validate", issues, commandCount })}\\n`, () => process.exit(0));',
    "",
  ].join("\n");
}

export function renderEntries(configImport: string): Record<EntryName, string> {
  return {
    shard: renderShardEntry(configImport),
    manager: renderManagerEntry(configImport),
    deploy: renderDeployEntry(configImport),
    validate: renderValidateEntry(configImport),
  };
}

async function writeIfChanged(file: string, content: string): Promise<boolean> {
  const current = await readFile(file, "utf8").catch(() => null);
  if (current === content) return false;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, content);
  return true;
}

export async function generate(scan: ProjectScan, options: GenerateOptions): Promise<GenerateResult> {
  const paths = projectPaths(scan.root);
  const configImport = relativePosix(paths.entriesDir, options.configFile);
  const outputs = new Map<string, string>([
    [paths.manifest, renderManifest(scan)],
    [paths.types, renderTypes(scan)],
  ]);
  for (const [name, content] of Object.entries(renderEntries(configImport))) {
    outputs.set(join(paths.entriesDir, `${name}.ts`), content);
  }

  const changed: string[] = [];
  for (const [file, content] of outputs) {
    if (await writeIfChanged(file, content)) changed.push(file);
  }
  return { files: [...outputs.keys()], changed };
}

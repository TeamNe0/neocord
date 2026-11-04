import { afterEach, describe, expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";
import { createFixture, LONG_TIMEOUT, runTsc, STANDARD_FILES, type Fixture } from "../test-support/fixture.ts";
import { generate, renderManifest, renderTypes } from "./codegen.ts";
import { scanProject } from "./scan.ts";

const fixtures: Fixture[] = [];

function fixture(files: Record<string, string>): Fixture {
  const created = createFixture({ files, stubs: false });
  fixtures.push(created);
  return created;
}

afterEach(() => {
  for (const created of fixtures.splice(0)) created.cleanup();
});

const configFileOf = (root: string): { configFile: string } => ({ configFile: join(root, "neocord.config.ts") });

describe("renderManifest", () => {
  test("imports every module statically with project-relative POSIX paths", async () => {
    const { root } = fixture(STANDARD_FILES);
    const manifest = renderManifest(await scanProject({ root }));

    expect(manifest).toContain('from "../src/context.ts";');
    expect(manifest).toContain('from "../src/middleware.ts";');
    expect(manifest).toContain('from "../src/features/moderation/feature.ts";');
    expect(manifest).toContain('from "../src/features/moderation/commands/(staff)/mod/group.ts";');
    expect(manifest).toContain('from "../src/features/moderation/buttons/confirm-ban/[userId]/button.tsx";');
    expect(manifest).toContain('file: "src/features/moderation/commands/ban/command.tsx"');
    expect(manifest).not.toContain("\\\\");
    expect(manifest).not.toContain("src/env.ts");
    expect(manifest).not.toContain("_lib");
    expect(manifest).toContain("export const manifest: Manifest = {");
  });

  test("has no comments", async () => {
    const { root } = fixture(STANDARD_FILES);
    const scan = await scanProject({ root });
    for (const output of [renderManifest(scan), renderTypes(scan)]) {
      expect(output).not.toMatch(/^\s*\/\//m);
      expect(output).not.toContain("/*");
    }
  });

  test("is deterministic regardless of creation order", async () => {
    const entries = Object.entries(STANDARD_FILES);
    const first = fixture(Object.fromEntries(entries));
    const second = fixture(Object.fromEntries(entries.toReversed()));
    const firstScan = await scanProject({ root: first.root });
    const secondScan = await scanProject({ root: second.root });
    expect(renderManifest(firstScan)).toBe(renderManifest(secondScan));
    expect(renderTypes(firstScan)).toBe(renderTypes(secondScan));
  });

  test("does not rewrite unchanged files", async () => {
    const { root } = fixture(STANDARD_FILES);
    const scan = await scanProject({ root });
    const first = await generate(scan, configFileOf(root));
    expect(first.changed.length).toBe(first.files.length);
    const before = statSync(join(root, ".neocord", "manifest.ts")).mtimeMs;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await generate(scan, configFileOf(root));
    expect(second.changed).toEqual([]);
    expect(statSync(join(root, ".neocord", "manifest.ts")).mtimeMs).toBe(before);
  });

  test("renders an empty project", async () => {
    const { root } = fixture({});
    const manifest = renderManifest(await scanProject({ root }));
    expect(manifest).toContain("context: null,");
    expect(manifest).toContain("features: [],");
    expect(manifest).toContain("groups: [],");
    expect(manifest).toContain("routes: [],");
  });
});

describe("renderTypes", () => {
  test("registers sorted route unions and the app context", async () => {
    const { root } = fixture(STANDARD_FILES);
    expect(renderTypes(await scanProject({ root }))).toBe(
      [
        'declare module "@neocord/react" {',
        "  interface RegisteredRoutes {",
        '    buttons: "general/refresh" | "moderation/confirm-ban/[userId]" | "moderation/pages/[...rest]";',
        '    selects: "moderation/pick-role";',
        '    modals: "moderation/ban-reason/[userId]";',
        "  }",
        "}",
        'declare module "neocord" {',
        "  interface RegisteredApp {",
        '    context: import("neocord").InferAppContext<typeof import("../src/context.ts").default>;',
        "  }",
        "}",
        "export {};",
        "",
      ].join("\n"),
    );
  });

  test("omits RegisteredApp without a context and uses never for empty unions", async () => {
    const { root } = fixture({ "src/features/a/buttons/go/button.tsx": "export {};\n" });
    const output = renderTypes(await scanProject({ root }));
    expect(output).toContain('buttons: "a/go";');
    expect(output).toContain("selects: never;");
    expect(output).toContain("modals: never;");
    expect(output).not.toContain("RegisteredApp");
    expect(output).not.toContain('declare module "neocord"');
  });

  const TYPE_STUBS: Record<string, string> = {
    "node_modules/neocord/package.json": JSON.stringify({
      name: "neocord",
      types: "./index.d.ts",
      exports: { ".": { types: "./index.d.ts" }, "./runtime": { types: "./runtime.d.ts" } },
    }),
    "node_modules/neocord/index.d.ts": [
      "export interface RegisteredApp {}",
      "export interface ContextDefinition<T> { value: T }",
      "export type InferAppContext<T> = T extends ContextDefinition<infer V> ? V : never;",
      "export type AppContext = RegisteredApp extends { context: infer C } ? C : Record<string, never>;",
      "",
    ].join("\n"),
    "node_modules/neocord/runtime.d.ts": [
      "export type ModuleNamespace = Record<string, unknown>;",
      "export interface ManifestModule { file: string; module: ModuleNamespace }",
      "export interface Manifest {",
      "  version: 1;",
      "  context: ModuleNamespace | null;",
      "  features: { name: string; module: ModuleNamespace | null }[];",
      "  groups: { feature: string; segments: string[]; file: string; module: ModuleNamespace }[];",
      "  routes: {",
      "    kind: string; id: string; feature: string; file: string; segments: string[]; module: ModuleNamespace;",
      "    middleware: ManifestModule[]; layouts: ManifestModule[];",
      "    error: ManifestModule | null; loading: ManifestModule | null;",
      "  }[];",
      "}",
      "",
    ].join("\n"),
    "node_modules/@neocord/react/package.json": JSON.stringify({ name: "@neocord/react", types: "./index.d.ts" }),
    "node_modules/@neocord/react/index.d.ts": [
      "export interface RegisteredRoutes {}",
      "export type ButtonRoute = RegisteredRoutes extends { buttons: infer R extends string } ? R : string;",
      "export type ModalRoute = RegisteredRoutes extends { modals: infer R extends string } ? R : string;",
      "",
    ].join("\n"),
  };

  const USAGE = [
    'import type { ButtonRoute, ModalRoute } from "@neocord/react";',
    'import type { AppContext } from "neocord";',
    'export const route: ButtonRoute = "a/go/[id]";',
    'export const modal: [ModalRoute] extends [never] ? "empty" : "filled" = "empty";',
    'export const wrong: "a/nope" extends ButtonRoute ? "leaked" : "narrowed" = "narrowed";',
    "",
  ];

  test(
    "types.d.ts augments the modules when compiled with tsc",
    async () => {
      const { root } = fixture({
        ...TYPE_STUBS,
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            target: "ES2023",
            lib: ["ES2023"],
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            noEmit: true,
            skipLibCheck: false,
            types: [],
          },
          include: ["src", ".neocord/types.d.ts"],
        }),
        "src/context.ts": 'export default { value: { db: "sqlite" } };\n',
        "src/features/a/buttons/go/[id]/button.ts": "export default {};\n",
        "src/usage.ts": [
          ...USAGE,
          'export const db: AppContext extends { db: string } ? "typed" : "untyped" = "typed";',
          "",
        ].join("\n"),
      });
      await generate(await scanProject({ root }), configFileOf(root));
      const result = runTsc(root);
      expect(result.output).toBe("");
      expect(result.code).toBe(0);
    },
    LONG_TIMEOUT,
  );

  test(
    "types.d.ts without a context compiles and leaves AppContext alone",
    async () => {
      const { root } = fixture({
        ...TYPE_STUBS,
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            target: "ES2023",
            lib: ["ES2023"],
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            noEmit: true,
            skipLibCheck: false,
            types: [],
          },
          include: ["src", ".neocord/types.d.ts"],
        }),
        "src/features/a/buttons/go/[id]/button.ts": "export default {};\n",
        "src/usage.ts": [
          ...USAGE,
          'export const db: AppContext extends { db: string } ? "typed" : "untyped" = "untyped";',
          "",
        ].join("\n"),
      });
      await generate(await scanProject({ root }), configFileOf(root));
      const result = runTsc(root);
      expect(result.output).toBe("");
      expect(result.code).toBe(0);
    },
    LONG_TIMEOUT,
  );

  test(
    "the generated manifest and entries type check against the runtime types",
    async () => {
      const { root } = fixture({
        ...TYPE_STUBS,
        "node_modules/neocord/runtime.d.ts": `${TYPE_STUBS["node_modules/neocord/runtime.d.ts"]}
export declare function startBot(options: { config: unknown; manifest: Manifest }): Promise<unknown>;
export declare function startManager(options: { config: unknown; shardFile: URL; shards?: number }): Promise<unknown>;
export declare function serializeCommands(manifest: Manifest): unknown[];
export declare function validateManifest(manifest: Manifest, config?: unknown): { severity: "error" | "warning"; file: string; message: string }[];
export declare function deployCommands(options: Record<string, unknown>): Promise<unknown>;
`,
        "node_modules/@types/node/package.json": JSON.stringify({ name: "@types/node", types: "./index.d.ts" }),
        "node_modules/@types/node/index.d.ts": [
          "declare const process: {",
          "  env: Record<string, string | undefined>;",
          "  stdout: { write(text: string, done: () => void): void };",
          "  stderr: { write(text: string, done: () => void): void };",
          "  exit(code: number): never;",
          "};",
          "interface ImportMeta { url: string }",
          "declare class URL { constructor(path: string, base: string) }",
          "",
        ].join("\n"),
        "tsconfig.json": JSON.stringify({
          compilerOptions: {
            target: "ES2023",
            lib: ["ES2023"],
            module: "ESNext",
            moduleResolution: "Bundler",
            allowImportingTsExtensions: true,
            jsx: "preserve",
            strict: true,
            noEmit: true,
            skipLibCheck: false,
            types: ["node"],
          },
          include: ["src", "neocord.config.ts", ".neocord"],
        }),
        "src/context.ts": "export default { value: {} };\n",
        "src/features/a/commands/ping/command.ts": "export default {};\n",
      });
      await generate(await scanProject({ root }), configFileOf(root));
      const result = runTsc(root);
      expect(result.output).toBe("");
      expect(result.code).toBe(0);
    },
    LONG_TIMEOUT,
  );
});

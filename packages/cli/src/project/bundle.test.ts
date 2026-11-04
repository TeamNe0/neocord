import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  bunCommand,
  cleanEnv,
  createFixture,
  LONG_TIMEOUT,
  nodeCommand,
  STANDARD_FILES,
  type Fixture,
} from "../test-support/fixture.ts";
import { BundleError, bundleEntries } from "./bundle.ts";
import { generate } from "./codegen.ts";
import { projectPaths } from "./paths.ts";
import { scanProject } from "./scan.ts";

interface RenderedElement {
  type: string;
  props: { reason?: string; children?: unknown };
}

interface RecordedRoute {
  id: string;
  rendered: RenderedElement | null;
  middleware: string[];
  layouts: string[];
}

interface RecordedManifest {
  version: number;
  hasContext: boolean;
  features: { name: string; hasModule: boolean }[];
  routes: RecordedRoute[];
}

function runBundle(command: string, file: string, root: string, env: Record<string, string> = {}): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, [file], { cwd: root, env: cleanEnv(env), encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("bundleEntries", () => {
  let fixture: Fixture;
  let shard: string;
  let manager: string;
  let deploy: string;

  beforeAll(async () => {
    fixture = createFixture({
      packageJson: { type: "commonjs" },
      config: `import { helper } from "~/lib/helper";\nexport default { intents: [helper] };\n`,
      files: {
        ...STANDARD_FILES,
        "src/lib/helper.ts": 'export const helper: string = "Guilds";\n',
        "tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "~/*": ["./src/*"] } } }),
        ".env": "SECRET_FROM_DOTENV=do-not-bundle\n",
      },
    });
    const scan = await scanProject({ root: fixture.root });
    await generate(scan, { configFile: join(fixture.root, "neocord.config.ts") });
    const { buildDir } = projectPaths(fixture.root);
    const result = await bundleEntries({ root: fixture.root, entries: ["shard", "manager", "deploy"], outDir: buildDir });
    expect(result.outputs.map((output) => output.entry)).toEqual(["shard", "manager", "deploy"]);
    expect(result.outputs.every((output) => output.bytes > 0)).toBe(true);
    shard = join(buildDir, "shard.js");
    manager = join(buildDir, "manager.js");
    deploy = join(buildDir, "deploy.js");
  }, LONG_TIMEOUT);

  afterAll(() => fixture.cleanup());

  test("the temp project path contains spaces", () => {
    expect(fixture.root).toContain(" ");
  });

  test("marks the output folder as ESM even in a CommonJS package", () => {
    expect(fixture.read(".neocord/build/package.json")).toBe('{"type":"module"}\n');
    expect(JSON.parse(fixture.read("package.json")).type).toBe("commonjs");
  });

  test("writes linked source maps and keeps packages external", () => {
    const code = readFileSync(shard, "utf8");
    expect(code).toContain("sourceMappingURL=shard.js.map");
    expect(fixture.exists(".neocord/build/shard.js.map")).toBe(true);
    expect(code).toContain('from "neocord/runtime"');
    expect(code).toContain('from "react/jsx-runtime"');
  });

  test("does not put env file contents in the bundle", () => {
    expect(readFileSync(shard, "utf8")).not.toContain("do-not-bundle");
  });

  test.each([
    ["node", nodeCommand],
    ["bun", bunCommand],
  ] as const)(
    "shard.js runs on %s with compiled JSX and the full manifest",
    (runtime, command) => {
      fixture.clearCalls();
      const result = runBundle(command(), shard, fixture.root);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);

      const [call] = fixture.calls();
      expect(call?.call).toBe("startBot");
      expect(call?.runtime).toBe(runtime);
      expect(call?.config).toEqual({ intents: ["Guilds"] });

      const manifest = call?.manifest as RecordedManifest;
      expect(manifest.version).toBe(1);
      expect(manifest.hasContext).toBe(true);
      expect(manifest.features).toEqual([
        { name: "general", hasModule: false },
        { name: "moderation", hasModule: true },
      ]);
      const ban = manifest.routes.find((route) => route.id === "ban");
      expect(ban?.rendered).toEqual({ type: "ban", props: { reason: "spam", children: "hello" } });
      expect(ban?.middleware).toHaveLength(3);
      expect(ban?.layouts).toHaveLength(2);
    },
    LONG_TIMEOUT,
  );

  test.each([
    ["node", nodeCommand],
    ["bun", bunCommand],
  ] as const)(
    "manager.js on %s points at the sibling shard.js and passes the shard count",
    (_runtime, command) => {
      fixture.clearCalls();
      expect(runBundle(command(), manager, fixture.root, { NEOCORD_SHARD_COUNT: "4" }).code).toBe(0);
      const [call] = fixture.calls();
      expect(call?.call).toBe("startManager");
      expect(call?.shards).toBe(4);
      expect(String(call?.shardFile)).toMatch(/^file:.*\/\.neocord\/build\/shard\.js$/);

      fixture.clearCalls();
      expect(runBundle(command(), manager, fixture.root).code).toBe(0);
      expect(fixture.calls()[0]?.shards).toBeNull();
    },
    LONG_TIMEOUT,
  );

  test(
    "deploy.js reads its options from the environment and prints a JSON result line",
    () => {
      fixture.clearCalls();
      const result = runBundle(nodeCommand(), deploy, fixture.root, {
        NEOCORD_DEPLOY_OPTIONS: JSON.stringify({ guildId: "123", force: true, stateFile: "state.json" }),
      });
      expect(result.code).toBe(0);
      const line = JSON.parse(result.stdout.trim()) as { neocord: string; result: { status: string; guildId: string } };
      expect(line.neocord).toBe("deploy");
      expect(line.result).toMatchObject({ status: "deployed", guildId: "123" });
      expect(fixture.calls()[0]).toMatchObject({ guildId: "123", force: true, stateFile: "state.json" });
    },
    LONG_TIMEOUT,
  );

  test(
    "deploy.js exits non-zero with the message on failure",
    () => {
      const result = runBundle(nodeCommand(), deploy, fixture.root, { STUB_DEPLOY_THROWS: "Discord said no" });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Discord said no");
      expect(result.stdout).toBe("");
    },
    LONG_TIMEOUT,
  );

  test(
    "reports bundle errors with file locations",
    async () => {
      const broken = createFixture({ files: { "src/features/a/commands/x/command.tsx": "export default {" } });
      try {
        const scan = await scanProject({ root: broken.root });
        await generate(scan, { configFile: join(broken.root, "neocord.config.ts") });
        let failure: unknown;
        try {
          await bundleEntries({ root: broken.root, entries: ["shard"], outDir: projectPaths(broken.root).buildDir });
        } catch (error) {
          failure = error;
        }
        expect(failure).toBeInstanceOf(BundleError);
        expect((failure as BundleError).details[0]).toContain("src/features/a/commands/x/command.tsx:1:");
      } finally {
        broken.cleanup();
      }
    },
    LONG_TIMEOUT,
  );
});

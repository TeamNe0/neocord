import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { createFixture, LONG_TIMEOUT, type Fixture } from "../test-support/fixture.ts";
import { ConfigError, EnvValidationError, loadConfig, parseCliConfig } from "./config.ts";

const fixtures: Fixture[] = [];

function fixture(config: string, files: Record<string, string> = {}): Fixture {
  const created = createFixture({ config, files });
  fixtures.push(created);
  return created;
}

async function captureError(run: () => Promise<unknown>): Promise<Error & { details?: readonly string[]; hint?: string }> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("Expected the call to fail");
}

const ENV_MODULE = `
if (!process.env.CONFIG_TEST_TOKEN) {
  console.error("❌ Invalid environment variables:", [
    { path: ["CONFIG_TEST_TOKEN"], message: "Required" },
    { path: [{ key: "DEV_GUILD_ID" }], message: "Expected string" },
  ]);
  throw new Error("Invalid environment variables");
}
export const env = { token: process.env.CONFIG_TEST_TOKEN };
`;

afterEach(() => {
  delete process.env.CONFIG_TEST_TOKEN;
  for (const created of fixtures.splice(0)) created.cleanup();
});

describe("loadConfig", () => {
  test(
    "bundles a TypeScript config with local imports and applies defaults",
    async () => {
      const { root, exists } = fixture(
        `import { name } from "./src/name";\nexport default { intents: [name] };\n`,
        { "src/name.ts": 'export const name: string = "Guilds";\n' },
      );
      const loaded = await loadConfig({ root });
      expect(loaded.raw).toEqual({ intents: ["Guilds"] });
      expect(loaded.config).toEqual({
        sourceDir: "src",
        featuresDir: "src/features",
        runtime: "auto",
        dev: { guildId: undefined, shards: 1 },
        deploy: { mode: "manual" },
      });
      expect(exists(".neocord/cache/config.mjs")).toBe(true);
    },
    LONG_TIMEOUT,
  );

  test(
    "loads each config file extension and external packages from the project",
    async () => {
      const { root, write, remove } = fixture(
        `import { defineConfig } from "neocord";\nexport default defineConfig({ runtime: "bun" });\n`,
      );
      expect((await loadConfig({ root })).config.runtime).toBe("bun");
      remove("neocord.config.ts");
      write("neocord.config.mjs", `export default { runtime: "node" };\n`);
      expect((await loadConfig({ root })).config.runtime).toBe("node");
    },
    LONG_TIMEOUT,
  );

  test(
    "picks up changes on reload",
    async () => {
      const { root, write } = fixture(`export default { dev: { shards: 1 } };\n`);
      expect((await loadConfig({ root })).config.dev.shards).toBe(1);
      write("neocord.config.ts", `export default { dev: { shards: 4 } };\n`);
      expect((await loadConfig({ root })).config.dev.shards).toBe(4);
    },
    LONG_TIMEOUT,
  );

  test(
    "re-evaluates an unchanged config so env changes are seen",
    async () => {
      const { root } = fixture(`export default { dev: { guildId: process.env.CONFIG_TEST_TOKEN } };\n`);
      process.env.CONFIG_TEST_TOKEN = "one";
      expect((await loadConfig({ root })).config.dev.guildId).toBe("one");
      process.env.CONFIG_TEST_TOKEN = "two";
      expect((await loadConfig({ root })).config.dev.guildId).toBe("two");
    },
    LONG_TIMEOUT,
  );

  test(
    "turns t3-env style failures into a readable error without replaying the raw log",
    async () => {
      const { root } = fixture(`import { env } from "./src/env";\nexport default { token: env.token };\n`, {
        "src/env.ts": ENV_MODULE,
      });
      const consoleError = spyOn(console, "error");
      const error = await captureError(() => loadConfig({ root }));
      expect(error).toBeInstanceOf(EnvValidationError);
      expect(error.message).toBe("Environment validation failed.");
      expect(error.details).toEqual(["CONFIG_TEST_TOKEN: Required", "DEV_GUILD_ID: Expected string"]);
      expect(consoleError).not.toHaveBeenCalled();
      consoleError.mockRestore();
    },
    LONG_TIMEOUT,
  );

  test(
    "passes once the environment is valid and restores console.error",
    async () => {
      const { root } = fixture(`import { env } from "./src/env";\nexport default { token: env.token };\n`, {
        "src/env.ts": ENV_MODULE,
      });
      process.env.CONFIG_TEST_TOKEN = "secret";
      const original = console.error;
      const loaded = await loadConfig({ root });
      expect(loaded.raw).toEqual({ token: "secret" });
      expect(console.error).toBe(original);
    },
    LONG_TIMEOUT,
  );

  test(
    "reports other load failures and replays console output",
    async () => {
      const { root } = fixture(`console.error("from config");\nthrow new Error("boom");\n`);
      const consoleError = spyOn(console, "error").mockImplementation(() => {});
      const error = await captureError(() => loadConfig({ root }));
      expect(error).toBeInstanceOf(ConfigError);
      expect(error.message).toContain("Could not load neocord.config.ts: boom");
      expect(consoleError).toHaveBeenCalledWith("from config");
      consoleError.mockRestore();
    },
    LONG_TIMEOUT,
  );

  test(
    "reports syntax errors with their location",
    async () => {
      const { root } = fixture(`export default {\n`);
      const error = await captureError(() => loadConfig({ root }));
      expect(error).toBeInstanceOf(ConfigError);
      expect(error.message).toContain("Could not bundle neocord.config.ts");
      expect(error.details?.[0]).toContain("neocord.config.ts:");
    },
    LONG_TIMEOUT,
  );

  test(
    "requires a default export",
    async () => {
      const { root } = fixture(`export const config = {};\n`);
      const error = await captureError(() => loadConfig({ root }));
      expect(error.message).toContain("has no default export");
    },
    LONG_TIMEOUT,
  );
});

describe("parseCliConfig", () => {
  const root = process.cwd();

  test("derives featuresDir from sourceDir and normalises paths", () => {
    expect(parseCliConfig(root, { sourceDir: "./app/" }).featuresDir).toBe("app/features");
    expect(parseCliConfig(root, { sourceDir: "app", featuresDir: "mods" }).featuresDir).toBe("mods");
  });

  test.each([
    [{ runtime: "deno" }, '"runtime" must be one of'],
    [{ deploy: { mode: "sometimes" } }, '"deploy.mode" must be one of'],
    [{ dev: { shards: 0 } }, '"dev.shards" must be a positive integer'],
    [{ dev: { shards: 1.5 } }, '"dev.shards" must be a positive integer'],
    [{ dev: { guildId: 1 } }, '"dev.guildId" must be a string'],
    [{ dev: 1 }, '"dev" must be an object'],
    [{ sourceDir: "../outside" }, '"sourceDir" must point to a folder inside the project'],
    [{ sourceDir: "." }, '"sourceDir" must point to a folder inside the project'],
    [{ featuresDir: 3 }, '"featuresDir" must be a non-empty string'],
    [null, "must default-export"],
    [[], "must default-export"],
  ])("rejects %j", (raw, message) => {
    expect(() => parseCliConfig(root, raw)).toThrow(message);
  });

  test("treats an empty or null guild id as unset", () => {
    expect(parseCliConfig(root, { dev: { guildId: "" } }).dev.guildId).toBeUndefined();
    expect(parseCliConfig(root, { dev: { guildId: null } }).dev.guildId).toBeUndefined();
  });
});

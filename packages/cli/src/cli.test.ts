import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "./cli.ts";
import { generate, loadConfig, loadEnvFiles, scanProject } from "./index.ts";
import {
  BIN,
  createCapture,
  createFixture,
  ensureDist,
  LONG_TIMEOUT,
  PACKAGE_ROOT,
  runCli,
  STANDARD_FILES,
  type Fixture,
} from "./test-support/fixture.ts";
import { formatBytes, formatTable, formatTree, Ui } from "./ui.ts";

const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, "package.json"), "utf8")) as { version: string };

beforeAll(() => ensureDist(), LONG_TIMEOUT);

describe("the built binary", () => {
  let fixture: Fixture;

  beforeAll(() => {
    fixture = createFixture({ files: STANDARD_FILES });
  });

  afterAll(() => fixture.cleanup());

  test("keeps a shebang with LF line endings", () => {
    const content = readFileSync(BIN);
    const firstLine = content.subarray(0, content.indexOf(0x0a) + 1).toString();
    expect(firstLine).toBe("#!/usr/bin/env node\n");
    expect(content.includes(0x0d)).toBe(false);
  });

  test(
    "--version reads the package version",
    async () => {
      const result = await runCli(["--version"]);
      expect(result.code).toBe(0);
      expect(result.stdout.trim()).toBe(manifest.version);
    },
    LONG_TIMEOUT,
  );

  test(
    "--help lists every command and the global option",
    async () => {
      const result = await runCli(["--help"]);
      expect(result.code).toBe(0);
      for (const command of ["dev", "build", "start", "deploy", "test", "typegen", "routes", "lint", "info"]) {
        expect(result.stdout).toContain(`  ${command}`);
      }
      expect(result.stdout).toContain("--cwd <dir>");
    },
    LONG_TIMEOUT,
  );

  test.each([
    ["dev", ["--shards <n>", "--no-deploy"]],
    ["build", ["--no-validate", "--typecheck"]],
    ["start", ["--shards <n>", "--deploy"]],
    ["deploy", ["--guild <id>", "--force", "--dry-run"]],
    ["test", ["--watch", "--coverage", "--no-validate", "--validate-only"]],
    ["routes", ["--json"]],
    ["lint", ["--fix"]],
  ] as const)(
    "%s --help documents its flags",
    async (command, flags) => {
      const result = await runCli([command, "--help"]);
      expect(result.code).toBe(0);
      for (const flag of flags) expect(result.stdout).toContain(flag);
    },
    LONG_TIMEOUT,
  );

  test(
    "routes runs from a spaced project path through node",
    async () => {
      expect(fixture.root).toContain(" ");
      const result = await runCli(["routes", "--cwd", fixture.root]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("moderation/pick-role");
    },
    LONG_TIMEOUT,
  );

  test(
    "also runs under bun",
    async () => {
      const version = await runCli(["--version"], { runtime: "bun" });
      expect(version.stdout.trim()).toBe(manifest.version);
      const routes = await runCli(["routes", "--json"], { cwd: fixture.root, runtime: "bun" });
      expect(routes.code).toBe(0);
      expect(JSON.parse(routes.stdout).routes.length).toBeGreaterThan(0);
    },
    LONG_TIMEOUT,
  );

  test(
    "rejects unknown commands and bad option values with a non-zero exit",
    async () => {
      const unknown = await runCli(["bogus"]);
      expect(unknown.code).toBe(1);
      expect(unknown.stderr).toContain("unknown command");

      const shards = await runCli(["start", "--shards", "zero"], { cwd: fixture.root });
      expect(shards.code).toBe(1);
      expect(shards.stderr).toContain("Expected a positive integer");
    },
    LONG_TIMEOUT,
  );
});

describe("main", () => {
  test("returns the exit code and writes through the provided streams", async () => {
    const exitCodeBefore = process.exitCode;
    const stdout = createCapture();
    const stderr = createCapture();
    const code = await main({
      argv: ["node", "neocord", "--version"],
      stdout: stdout.stream,
      stderr: stderr.stream,
      env: {},
    });
    process.exitCode = exitCodeBefore;
    expect(code).toBe(0);
    expect(stdout.text().trim()).toBe(manifest.version);
  });
});

describe("programmatic API", () => {
  test(
    "scanProject, generate, loadConfig and loadEnvFiles work together",
    async () => {
      const fixture = createFixture({ files: { ...STANDARD_FILES, ".env": "FIXTURE_VALUE=api\n" } });
      try {
        const env = loadEnvFiles({ root: fixture.root, mode: "test", env: {}, bunAutoload: false });
        expect(env.env.FIXTURE_VALUE).toBe("api");
        const { config, file } = await loadConfig({ root: fixture.root });
        const scan = await scanProject({ root: fixture.root, sourceDir: config.sourceDir, featuresDir: config.featuresDir });
        const generated = await generate(scan, { configFile: file });
        expect(generated.files.length).toBe(6);
        expect(fixture.read(".neocord/entries/shard.ts")).toContain("startBot");
      } finally {
        fixture.cleanup();
      }
    },
    LONG_TIMEOUT,
  );
});

describe("ui", () => {
  test("is colourless without a TTY and colours when forced", () => {
    const plain = createCapture();
    new Ui({ stdout: plain.stream, stderr: plain.stream, env: {} }).success("done");
    expect(plain.text()).toBe("✓ done\n");

    const forced = createCapture();
    new Ui({ stdout: forced.stream, stderr: forced.stream, env: { FORCE_COLOR: "1" } }).success("done");
    expect(forced.text()).toContain("\u001b[");

    const noColor = createCapture();
    new Ui({ stdout: { ...noColor.stream, isTTY: true }, stderr: noColor.stream, env: { NO_COLOR: "1" } }).success("done");
    expect(noColor.text()).toBe("✓ done\n");
  });

  test("formats tables, trees and sizes", () => {
    expect(formatTable(["a", "bb"], [["1", "2"], ["333", "4"]])).toEqual(["a    bb", "---  --", "1    2", "333  4"]);
    expect(formatTree([{ label: "x", children: [{ label: "y" }] }, { label: "z" }])).toEqual(["├─ x", "│  └─ y", "└─ z"]);
    expect(formatBytes(12)).toBe("12 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});

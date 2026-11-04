import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  createFixture,
  ensureDist,
  LONG_TIMEOUT,
  runCli,
  STANDARD_FILES,
  type CliResult,
  type Fixture,
} from "../test-support/fixture.ts";
import { commandTree } from "./deploy.ts";
import { runnerCommand, selectTestRunner } from "./test.ts";

const fixtures: Fixture[] = [];

function fixture(options: Parameters<typeof createFixture>[0] = {}): Fixture {
  const created = createFixture({ files: STANDARD_FILES, ...options });
  fixtures.push(created);
  return created;
}

function cli(project: Fixture, args: readonly string[], env: Record<string, string | undefined> = {}): Promise<CliResult> {
  return runCli(args, { cwd: project.root, env });
}

const STRICT_ENV_MODULE = `if (!process.env.SKIP_ENV_VALIDATION) {
  console.error("❌ Invalid environment variables:", [{ path: ["DISCORD_TOKEN"], message: "Required" }]);
  throw new Error("Invalid environment variables");
}
export const env = { DISCORD_TOKEN: process.env.DISCORD_TOKEN };
`;

const TOKEN_ENV_MODULE = `if (!process.env.SKIP_ENV_VALIDATION && !process.env.DISCORD_TOKEN) {
  console.error("❌ Invalid environment variables:", [{ path: ["DISCORD_TOKEN"], message: "Required" }]);
  throw new Error("Invalid environment variables");
}
export const env = { DISCORD_TOKEN: process.env.DISCORD_TOKEN };
`;

const ENV_CONFIG = `import { env } from "./src/env";\nexport default { intents: ["Guilds"], token: env.DISCORD_TOKEN, runtime: "node" };\n`;

beforeAll(() => ensureDist(), LONG_TIMEOUT);

afterEach(() => {
  for (const created of fixtures.splice(0)) created.cleanup();
});

describe("project discovery", () => {
  test(
    "walks up from a nested folder and honours --cwd",
    async () => {
      const project = fixture();
      const nested = await runCli(["routes", "--json"], { cwd: join(project.root, "src", "features") });
      expect(nested.code).toBe(0);
      const viaFlag = await runCli(["--cwd", project.root, "routes", "--json"]);
      expect(viaFlag.code).toBe(0);
      const flagAfter = await runCli(["routes", "--json", "--cwd", project.root]);
      expect(flagAfter.code).toBe(0);
      expect(JSON.parse(viaFlag.stdout)).toEqual(JSON.parse(nested.stdout));
    },
    LONG_TIMEOUT,
  );

  test(
    "suggests bun create neocord when there is no config",
    async () => {
      const project = fixture();
      project.remove("neocord.config.ts");
      const result = await runCli(["routes"], { cwd: project.root });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("No neocord.config file found");
      expect(result.stderr).toContain("bun create neocord");
      expect(result.stderr).not.toContain("    at ");
    },
    LONG_TIMEOUT,
  );

  test(
    "errors on a --cwd that does not exist",
    async () => {
      const result = await runCli(["routes", "--cwd", join(dirname(process.cwd()), "does not exist at all")]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("does not exist");
    },
    LONG_TIMEOUT,
  );

  test(
    "shows config errors clearly",
    async () => {
      const project = fixture({ config: 'export default { runtime: "deno" };\n' });
      const result = await cli(project, ["routes"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('"runtime" must be one of');
      expect(result.stderr).not.toContain("    at ");
    },
    LONG_TIMEOUT,
  );
});

describe("neocord routes", () => {
  test(
    "--json lists sorted routes with their chains",
    async () => {
      const project = fixture();
      const result = await cli(project, ["routes", "--json"]);
      expect(result.code).toBe(0);
      const { routes, issues } = JSON.parse(result.stdout) as {
        routes: { kind: string; id: string; middleware: string[] }[];
        issues: unknown[];
      };
      expect(issues).toEqual([]);
      expect(routes[0]?.kind).toBe("command");
      expect(routes.map((route) => route.id)).toContain("mod case view");
      expect(routes.find((route) => route.id === "ban")?.middleware).toHaveLength(3);
    },
    LONG_TIMEOUT,
  );

  test(
    "prints a table without colour when piped",
    async () => {
      const project = fixture();
      const result = await cli(project, ["routes"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("moderation/confirm-ban/[userId]");
      expect(result.stdout).toContain("src/features/general/commands/ping/command.tsx");
      expect(result.stdout).not.toContain("\u001b[");
    },
    LONG_TIMEOUT,
  );

  test(
    "fails and lists problems for colliding routes",
    async () => {
      const project = fixture({
        files: {
          "src/features/a/commands/ban/command.tsx": "export {};\n",
          "src/features/b/commands/ban/command.tsx": "export {};\n",
        },
      });
      const result = await cli(project, ["routes"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("src/features/b/commands/ban/command.tsx");
      expect(result.stderr).toContain('command route "ban"');

      const json = await cli(project, ["routes", "--json"]);
      expect(json.code).toBe(1);
      expect((JSON.parse(json.stdout) as { issues: unknown[] }).issues).toHaveLength(1);
    },
    LONG_TIMEOUT,
  );
});

describe("neocord typegen", () => {
  test(
    "writes the generated files and is idempotent",
    async () => {
      const project = fixture();
      const first = await cli(project, ["typegen"]);
      expect(first.code).toBe(0);
      expect(first.stdout).toContain("Wrote 6 files");
      for (const file of ["manifest.ts", "types.d.ts", "entries/shard.ts", "entries/manager.ts", "entries/deploy.ts"]) {
        expect(project.exists(`.neocord/${file}`)).toBe(true);
      }
      const manifest = project.read(".neocord/manifest.ts");
      const second = await cli(project, ["typegen"]);
      expect(second.stdout).toContain("already up to date");
      expect(project.read(".neocord/manifest.ts")).toBe(manifest);
    },
    LONG_TIMEOUT,
  );

  test(
    "exits non-zero and names invalid files",
    async () => {
      const project = fixture({ files: { "src/features/a/stray.ts": "export {};\n" } });
      const result = await cli(project, ["typegen"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("src/features/a/stray.ts");
      expect(project.exists(".neocord/types.d.ts")).toBe(true);
    },
    LONG_TIMEOUT,
  );
});

describe("neocord build", () => {
  test(
    "bundles every entry, validates, and prints the summary and sizes",
    async () => {
      const project = fixture();
      const result = await cli(project, ["build"]);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      for (const file of ["shard.js", "manager.js", "deploy.js", "package.json"]) {
        expect(project.exists(`.neocord/build/${file}`)).toBe(true);
      }
      expect(project.exists(".neocord/build/validate.mjs")).toBe(false);
      expect(result.stdout).toContain("moderation");
      expect(result.stdout).toContain("total");
      expect(result.stdout).toContain(".neocord/build/shard.js");
      expect(result.stdout).toMatch(/\d+(\.\d+)? (B|KB)/);
      const validated = project.calls().find((call) => call.call === "validateManifest");
      expect(validated?.env.NODE_ENV).toBe("production");
    },
    LONG_TIMEOUT,
  );

  test(
    "fails on invalid files with file and reason and writes no bundle",
    async () => {
      const project = fixture({ files: { "src/features/a/commands/x/helper.ts": "export {};\n" } });
      const result = await cli(project, ["build"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("src/features/a/commands/x/helper.ts");
      expect(result.stderr).toContain('must be named "command.ts"');
      expect(project.exists(".neocord/build/shard.js")).toBe(false);
    },
    LONG_TIMEOUT,
  );

  test(
    "fails on a route collision",
    async () => {
      const project = fixture({
        files: {
          "src/features/a/buttons/go/button.tsx": "export {};\n",
          "src/features/a/buttons/(b)/go/button.tsx": "export {};\n",
        },
      });
      const result = await cli(project, ["build"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain('button route "a/go"');
    },
    LONG_TIMEOUT,
  );

  test(
    "prints validation warnings and fails on validation errors unless skipped",
    async () => {
      const project = fixture();
      const warning = JSON.stringify([{ severity: "warning", file: "src/x.ts", message: "be careful" }]);
      const warned = await cli(project, ["build"], { STUB_VALIDATE_ISSUES: warning });
      expect(warned.code).toBe(0);
      expect(warned.stderr).toContain("src/x.ts: be careful");

      const failing = JSON.stringify([{ severity: "error", file: "src/y.ts", message: "broken payload" }]);
      const failed = await cli(project, ["build"], { STUB_VALIDATE_ISSUES: failing });
      expect(failed.code).toBe(1);
      expect(failed.stderr).toContain("src/y.ts: broken payload");

      const skipped = await cli(project, ["build", "--no-validate"], { STUB_VALIDATE_ISSUES: failing });
      expect(skipped.code).toBe(0);
    },
    LONG_TIMEOUT,
  );

  test(
    "reports a route module that throws while validating",
    async () => {
      const project = fixture({
        files: { "src/features/a/commands/x/command.tsx": 'throw new Error("module exploded");\n' },
      });
      const result = await cli(project, ["build"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("module exploded");
      expect(result.stderr).toContain("Validation could not run");
    },
    LONG_TIMEOUT,
  );

  test(
    "--typecheck runs tsc from the project and fails the build",
    async () => {
      const project = fixture({
        files: {
          "node_modules/typescript/package.json": JSON.stringify({ name: "typescript", bin: { tsc: "./tsc.js" } }),
          "node_modules/typescript/tsc.js": [
            'const { appendFileSync } = require("node:fs");',
            'appendFileSync("calls.jsonl", JSON.stringify({ call: "tsc", args: process.argv.slice(2), env: {} }) + "\\n");',
            "process.exit(Number(process.env.STUB_TSC_EXIT ?? 0));",
            "",
          ].join("\n"),
        },
      });
      const ok = await cli(project, ["build", "--typecheck"]);
      expect(ok.code).toBe(0);
      expect(project.calls().find((call) => call.call === "tsc")?.args).toEqual(["--noEmit"]);

      const failed = await cli(project, ["build", "--typecheck"], { STUB_TSC_EXIT: "2" });
      expect(failed.code).toBe(2);
      expect(failed.stderr).toContain("Type checking failed");
    },
    LONG_TIMEOUT,
  );
});

describe("neocord start", () => {
  test(
    "requires a production build",
    async () => {
      const project = fixture();
      const result = await cli(project, ["start"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Run neocord build first");
    },
    LONG_TIMEOUT,
  );

  test(
    "launches the manager, forwards the exit code and sets the shard count",
    async () => {
      const project = fixture({ files: { ...STANDARD_FILES, ".env.production": "FIXTURE_VALUE=prod\n" } });
      expect((await cli(project, ["build", "--no-validate"])).code).toBe(0);
      project.clearCalls();

      const result = await cli(project, ["start", "--shards", "3"], { STUB_EXIT_CODE: "17" });
      expect(result.code).toBe(17);
      const [call] = project.calls();
      expect(call?.call).toBe("startManager");
      expect(call?.shards).toBe(3);
      expect(call?.env).toMatchObject({ NODE_ENV: "production", NEOCORD_SHARD_COUNT: "3", FIXTURE_VALUE: "prod" });
    },
    LONG_TIMEOUT,
  );

  test(
    "--deploy deploys first, then starts",
    async () => {
      const project = fixture();
      expect((await cli(project, ["build", "--no-validate"])).code).toBe(0);
      project.clearCalls();
      const result = await cli(project, ["start", "--deploy"]);
      expect(result.code).toBe(0);
      expect(project.calls().map((call) => call.call)).toEqual(["deployCommands", "startManager"]);
    },
    LONG_TIMEOUT,
  );

  test(
    "a failed deploy stops the launch",
    async () => {
      const project = fixture();
      expect((await cli(project, ["build", "--no-validate"])).code).toBe(0);
      project.clearCalls();
      const result = await cli(project, ["start", "--deploy"], { STUB_DEPLOY_THROWS: "Discord said no" });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Discord said no");
      expect(project.calls().map((call) => call.call)).toEqual(["deployCommands"]);
    },
    LONG_TIMEOUT,
  );

  test(
    'deploy.mode "auto" deploys without the flag',
    async () => {
      const project = fixture({ config: 'export default { deploy: { mode: "auto" }, runtime: "node" };\n' });
      expect((await cli(project, ["build", "--no-validate"])).code).toBe(0);
      project.clearCalls();
      expect((await cli(project, ["start"])).code).toBe(0);
      expect(project.calls().map((call) => call.call)).toEqual(["deployCommands", "startManager"]);
    },
    LONG_TIMEOUT,
  );

  test(
    'runtime: "bun" launches the manager with bun',
    async () => {
      const project = fixture({ config: 'export default { runtime: "bun" };\n' });
      expect((await cli(project, ["build", "--no-validate"])).code).toBe(0);
      project.clearCalls();
      expect((await cli(project, ["start"])).code).toBe(0);
      expect(project.calls()[0]?.runtime).toBe("bun");
    },
    LONG_TIMEOUT,
  );

  test(
    "does not print the token",
    async () => {
      const project = fixture({ files: { ...STANDARD_FILES, ".env": "DISCORD_TOKEN=super-secret-token\n" } });
      expect((await cli(project, ["build", "--no-validate"])).code).toBe(0);
      const result = await cli(project, ["start", "--deploy"]);
      expect(result.code).toBe(0);
      expect(`${result.stdout}${result.stderr}`).not.toContain("super-secret-token");
    },
    LONG_TIMEOUT,
  );
});

describe("neocord deploy", () => {
  function stale(project: Fixture, path: string): void {
    const future = new Date(Date.now() + 60_000);
    utimesSync(join(project.root, path), future, future);
  }

  test(
    "builds first when the bundle is missing, and passes options",
    async () => {
      const project = fixture();
      const result = await cli(project, ["deploy", "--guild", "123", "--force"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Building first");
      expect(result.stdout).toContain("Deployed 4 commands to guild 123 (hash stubhash)");
      expect(project.exists(".neocord/build/deploy.js")).toBe(true);
      const call = project.calls().find((item) => item.call === "deployCommands");
      expect(call).toMatchObject({ guildId: "123", force: true, dryRun: false });
      expect(call?.env.NODE_ENV).toBe("production");
      expect(String(call?.stateFile)).toEndWith(join(".neocord", "deploy.json"));
    },
    LONG_TIMEOUT,
  );

  test(
    "reuses a fresh bundle and rebuilds a stale one",
    async () => {
      const project = fixture();
      expect((await cli(project, ["build"])).code).toBe(0);

      const fresh = await cli(project, ["deploy"]);
      expect(fresh.code).toBe(0);
      expect(fresh.stdout).not.toContain("Building first");

      for (const path of ["src/features/general/commands/ping/command.tsx", "neocord.config.ts", "src/lib/ignored.ts"]) {
        expect((await cli(project, ["build"])).code).toBe(0);
        stale(project, path);
        const rebuilt = await cli(project, ["deploy"]);
        expect(rebuilt.code).toBe(0);
        expect(rebuilt.stdout).toContain("Building first");
        const reset = new Date(Date.now() - 60_000);
        utimesSync(join(project.root, path), reset, reset);
      }
    },
    LONG_TIMEOUT,
  );

  test(
    "notices a removed source file through the folder time",
    async () => {
      const project = fixture();
      expect((await cli(project, ["build"])).code).toBe(0);
      project.remove("src/features/general/buttons/refresh/button.tsx");
      stale(project, "src/features/general/buttons/refresh");
      const rebuilt = await cli(project, ["deploy"]);
      expect(rebuilt.stdout).toContain("Building first");
      expect(project.read(".neocord/manifest.ts")).not.toContain("refresh");
    },
    LONG_TIMEOUT,
  );

  test(
    "--dry-run prints a command tree",
    async () => {
      const project = fixture();
      const result = await cli(project, ["deploy", "--dry-run"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Dry run: would deploy 4 commands to global scope");
      expect(result.stdout).toContain("/ping");
      expect(result.stdout).toMatch(/[├└]─ \/ban/);
      expect(project.calls().find((call) => call.call === "deployCommands")?.dryRun).toBe(true);
    },
    LONG_TIMEOUT,
  );

  test(
    "propagates a failed deploy",
    async () => {
      const project = fixture();
      const result = await cli(project, ["deploy"], { STUB_DEPLOY_THROWS: "Discord said no" });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Discord said no");
      expect(result.stderr).toContain("Deploy failed.");
    },
    LONG_TIMEOUT,
  );

  test("renders nested command trees", () => {
    expect(
      commandTree([
        {
          name: "mod",
          type: 1,
          options: [
            { name: "warn", type: 1, options: [{ name: "user", type: 6 }] },
            { name: "case", type: 2, options: [{ name: "view", type: 1 }] },
          ],
        },
        { name: "Report", type: 2 },
        { name: "Quote", type: 3 },
        "nonsense",
      ]),
    ).toEqual([
      {
        label: "/mod",
        children: [
          { label: "warn", children: [{ label: "<user>" }] },
          { label: "case", children: [{ label: "view", children: [] }] },
        ],
      },
      { label: "Report (user)" },
      { label: "Quote (message)" },
    ]);
  });
});

describe("neocord test", () => {
  const VITEST_STUB = {
    "node_modules/vitest/package.json": JSON.stringify({ name: "vitest", version: "3.0.0", bin: { vitest: "./vitest.mjs" } }),
    "node_modules/vitest/vitest.mjs": [
      'import { appendFileSync } from "node:fs";',
      'appendFileSync("calls.jsonl", JSON.stringify({ call: "vitest", args: process.argv.slice(2), env: { NODE_ENV: process.env.NODE_ENV, SKIP_ENV_VALIDATION: process.env.SKIP_ENV_VALIDATION } }) + "\\n");',
      "process.exit(Number(process.env.STUB_VITEST_EXIT ?? 0));",
      "",
    ].join("\n"),
  };

  test(
    "--validate-only succeeds without running tests",
    async () => {
      const project = fixture({
        files: { ...STANDARD_FILES, "src/failing.test.ts": 'throw new Error("must not run");\n' },
      });
      const result = await cli(project, ["test", "--validate-only"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("Validated");
      const call = project.calls().find((item) => item.call === "validateManifest");
      expect(call?.env.NODE_ENV).toBe("test");
    },
    LONG_TIMEOUT,
  );

  test(
    "--validate-only fails on validation errors, invalid files and serialization failures",
    async () => {
      const project = fixture();
      const issues = JSON.stringify([{ severity: "error", file: "src/y.ts", message: "broken payload" }]);
      const invalidPayload = await cli(project, ["test", "--validate-only"], { STUB_VALIDATE_ISSUES: issues });
      expect(invalidPayload.code).toBe(1);
      expect(invalidPayload.stderr).toContain("src/y.ts: broken payload");

      const serialize = await cli(project, ["test", "--validate-only"], { STUB_SERIALIZE_THROWS: "cannot serialize" });
      expect(serialize.code).toBe(1);
      expect(serialize.stderr).toContain("cannot serialize");

      project.write("src/features/a/stray.ts", "export {};\n");
      const invalidFile = await cli(project, ["test", "--validate-only"]);
      expect(invalidFile.code).toBe(1);
      expect(invalidFile.stderr).toContain("src/features/a/stray.ts");
    },
    LONG_TIMEOUT,
  );

  test(
    "rejects --no-validate with --validate-only",
    async () => {
      const project = fixture();
      const result = await cli(project, ["test", "--no-validate", "--validate-only"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("cannot be used together");
    },
    LONG_TIMEOUT,
  );

  test(
    "uses vitest when it is a project dependency and forwards files, flags and the exit code",
    async () => {
      const project = fixture({
        packageJson: { devDependencies: { vitest: "3.0.0" } },
        files: { ...STANDARD_FILES, ...VITEST_STUB },
      });
      const result = await cli(project, ["test", "src/a.test.ts", "--coverage", "--bail=1"], { STUB_VITEST_EXIT: "5" });
      expect(result.code).toBe(5);
      const call = project.calls().find((item) => item.call === "vitest");
      expect(call?.args).toEqual(["run", "--passWithNoTests", "--coverage", "src/a.test.ts", "--bail=1"]);
      expect(call?.env.NODE_ENV).toBe("test");

      project.clearCalls();
      await cli(project, ["test", "--watch", "--no-validate"]);
      expect(project.calls().map((item) => item.call)).toEqual(["vitest"]);
      expect(project.calls()[0]?.args).toEqual(["watch", "--passWithNoTests"]);
    },
    LONG_TIMEOUT,
  );

  test(
    "falls back to bun test and forwards its exit code",
    async () => {
      const project = fixture({
        files: {
          ...STANDARD_FILES,
          "src/passing.test.ts": 'import { test, expect } from "bun:test";\ntest("adds", () => expect(process.env.NODE_ENV).toBe("test"));\n',
        },
      });
      const passed = await cli(project, ["test"]);
      expect(passed.stderr).toContain("1 pass");
      expect(passed.code).toBe(0);

      project.write("src/failing.test.ts", 'import { test, expect } from "bun:test";\ntest("fails", () => expect(1).toBe(2));\n');
      const failed = await cli(project, ["test"]);
      expect(failed.code).toBe(1);
      expect(failed.stderr).toContain("1 fail");
    },
    LONG_TIMEOUT,
  );

  test(
    "reports success when there are no tests",
    async () => {
      const project = fixture({
        files: Object.fromEntries(Object.entries(STANDARD_FILES).filter(([path]) => !path.includes(".test."))),
      });
      const result = await cli(project, ["test"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toContain("No tests found.");
    },
    LONG_TIMEOUT,
  );

  test(
    "gives an actionable error with neither bun nor vitest",
    async () => {
      const project = fixture();
      const result = await cli(project, ["test"], { PATH: dirname(project.root), Path: dirname(project.root) });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("No test runner found");
      expect(result.stderr).toContain("vitest");
      expect(result.stderr).toContain("bun");
    },
    LONG_TIMEOUT,
  );

  test("selects runners in the documented order", () => {
    const withVitest = fixture({
      stubs: false,
      packageJson: { devDependencies: { vitest: "3.0.0" } },
      files: VITEST_STUB,
    });
    expect(selectTestRunner(withVitest.root, { findBun: () => "bun" }).kind).toBe("vitest");

    const declaredOnly = fixture({ stubs: false, packageJson: { devDependencies: { vitest: "3.0.0" } }, files: {} });
    expect(() => selectTestRunner(declaredOnly.root, { findBun: () => "bun" })).toThrow("not installed");

    const plain = fixture({ stubs: false, files: {} });
    expect(selectTestRunner(plain.root, { findBun: () => "/bin/bun" })).toEqual({ kind: "bun", command: "/bin/bun" });
    expect(() => selectTestRunner(plain.root, { findBun: () => null })).toThrow("No test runner found");
  });

  test("builds the bun command line", () => {
    const { command, args } = runnerCommand(
      { kind: "bun", command: "/bin/bun" },
      { files: ["a.test.ts"], watch: true, coverage: true, validate: true, validateOnly: false },
    );
    expect(command).toBe("/bin/bun");
    expect(args).toEqual(["--no-env-file", "test", "--watch", "--coverage", "a.test.ts"]);
  });
});

describe("neocord lint", () => {
  const ESLINT_STUB = {
    "node_modules/eslint/package.json": JSON.stringify({ name: "eslint", bin: { eslint: "./bin/eslint.js" } }),
    "node_modules/eslint/bin/eslint.js": [
      'const { appendFileSync } = require("node:fs");',
      'appendFileSync("calls.jsonl", JSON.stringify({ call: "eslint", args: process.argv.slice(2), env: {} }) + "\\n");',
      "process.exit(Number(process.env.STUB_ESLINT_EXIT ?? 0));",
      "",
    ].join("\n"),
  };

  test(
    "runs the project eslint, forwarding --fix and the exit code",
    async () => {
      const project = fixture({ files: ESLINT_STUB });
      const result = await cli(project, ["lint", "--fix"], { STUB_ESLINT_EXIT: "2" });
      expect(result.code).toBe(2);
      expect(project.calls()[0]?.args).toEqual([".", "--fix"]);
    },
    LONG_TIMEOUT,
  );

  test(
    "explains when eslint is not installed",
    async () => {
      const project = fixture();
      const result = await cli(project, ["lint"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("ESLint is not installed");
    },
    LONG_TIMEOUT,
  );
});

describe("neocord info", () => {
  test(
    "prints versions and only whether the token is set",
    async () => {
      const project = fixture({ files: { ...STANDARD_FILES, ".env": "DISCORD_TOKEN=super-secret-token\nOTHER_SECRET=hidden-value\n" } });
      const result = await cli(project, ["info"], { npm_config_user_agent: undefined });
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/@neocord\/cli\s+0\./);
      expect(result.stdout).toMatch(/neocord\s+9\.9\.9/);
      expect(result.stdout).toMatch(/react\s+19\.9\.9/);
      expect(result.stdout).toMatch(/discord\.js\s+not installed/);
      expect(result.stdout).toMatch(/runtime\s+node \(config: node\)/);
      expect(result.stdout).toMatch(/DISCORD_TOKEN\s+set/);
      const everything = `${result.stdout}${result.stderr}`;
      expect(everything).not.toContain("super-secret-token");
      expect(everything).not.toContain("hidden-value");
    },
    LONG_TIMEOUT,
  );

  test(
    "does not leak a token from the real environment",
    async () => {
      const project = fixture();
      const result = await cli(project, ["info"], { DISCORD_TOKEN: "real-env-secret" });
      expect(result.stdout).toMatch(/DISCORD_TOKEN\s+set/);
      expect(`${result.stdout}${result.stderr}`).not.toContain("real-env-secret");
    },
    LONG_TIMEOUT,
  );

  test(
    "reports an unset token and survives a broken config and a missing project",
    async () => {
      const broken = fixture({ config: 'throw new Error("broken config");\n' });
      const result = await cli(broken, ["info"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/DISCORD_TOKEN\s+not set/);
      expect(result.stdout).toContain("broken config");

      broken.remove("neocord.config.ts");
      const outside = await cli(broken, ["info"]);
      expect(outside.code).toBe(0);
      expect(outside.stdout).toMatch(/project\s+not found/);
    },
    LONG_TIMEOUT,
  );
});

describe("SKIP_ENV_VALIDATION", () => {
  let strict: Fixture;

  beforeAll(() => {
    strict = createFixture({
      config: ENV_CONFIG,
      files: { ...STANDARD_FILES, "src/env.ts": STRICT_ENV_MODULE },
    });
  });

  afterAll(() => strict.cleanup());

  test(
    "typegen succeeds without secrets",
    async () => {
      const result = await cli(strict, ["typegen"]);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
    },
    LONG_TIMEOUT,
  );

  test(
    "routes succeeds without secrets",
    async () => {
      const result = await cli(strict, ["routes", "--json"]);
      expect(result.code).toBe(0);
    },
    LONG_TIMEOUT,
  );

  test(
    "info reads the config without secrets",
    async () => {
      const result = await cli(strict, ["info"]);
      expect(result.code).toBe(0);
      expect(result.stdout).toMatch(/runtime\s+node \(config: node\)/);
    },
    LONG_TIMEOUT,
  );

  test(
    "build and its validation child succeed without secrets",
    async () => {
      strict.clearCalls();
      const result = await cli(strict, ["build"]);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(strict.calls().find((call) => call.call === "validateManifest")?.env.SKIP_ENV_VALIDATION).toBe("true");
    },
    LONG_TIMEOUT,
  );

  test(
    "test --validate-only succeeds without secrets",
    async () => {
      strict.clearCalls();
      const result = await cli(strict, ["test", "--validate-only"]);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(strict.calls().find((call) => call.call === "validateManifest")?.env.SKIP_ENV_VALIDATION).toBe("true");
    },
    LONG_TIMEOUT,
  );

  test(
    "the test runner child also gets it",
    async () => {
      const project = fixture({
        config: ENV_CONFIG,
        packageJson: { devDependencies: { vitest: "3.0.0" } },
        files: {
          ...STANDARD_FILES,
          "src/env.ts": STRICT_ENV_MODULE,
          "node_modules/vitest/package.json": JSON.stringify({ name: "vitest", bin: { vitest: "./vitest.mjs" } }),
          "node_modules/vitest/vitest.mjs": [
            'import { appendFileSync } from "node:fs";',
            'appendFileSync("calls.jsonl", JSON.stringify({ call: "vitest", env: { SKIP_ENV_VALIDATION: process.env.SKIP_ENV_VALIDATION } }) + "\\n");',
            "",
          ].join("\n"),
        },
      });
      const result = await cli(project, ["test"]);
      expect(result.code).toBe(0);
      expect(project.calls().find((call) => call.call === "vitest")?.env.SKIP_ENV_VALIDATION).toBe("true");
    },
    LONG_TIMEOUT,
  );

  test(
    "a value the user set is kept",
    async () => {
      strict.clearCalls();
      const result = await cli(strict, ["test", "--validate-only"], { SKIP_ENV_VALIDATION: "1" });
      expect(result.code).toBe(0);
      expect(strict.calls().find((call) => call.call === "validateManifest")?.env.SKIP_ENV_VALIDATION).toBe("1");
    },
    LONG_TIMEOUT,
  );

  test(
    "start does not set it and fails with a readable env error",
    async () => {
      expect((await cli(strict, ["build", "--no-validate"])).code).toBe(0);
      strict.clearCalls();
      const result = await cli(strict, ["start"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Environment validation failed.");
      expect(result.stderr).toContain("DISCORD_TOKEN: Required");
      expect(result.stderr).not.toContain("    at ");
      expect(result.stderr).not.toContain("❌");
      expect(strict.calls()).toEqual([]);
    },
    LONG_TIMEOUT,
  );

  test(
    "start with a real token runs without the skip flag in the child",
    async () => {
      const project = fixture({
        config: ENV_CONFIG,
        files: { ...STANDARD_FILES, "src/env.ts": TOKEN_ENV_MODULE },
      });
      expect((await cli(project, ["build", "--no-validate"])).code).toBe(0);
      project.clearCalls();
      const result = await cli(project, ["start"], { DISCORD_TOKEN: "real-token" });
      expect(result.code).toBe(0);
      const call = project.calls().find((item) => item.call === "startManager");
      expect(call).toBeDefined();
      expect(call?.env.SKIP_ENV_VALIDATION).toBeUndefined();
      expect(`${result.stdout}${result.stderr}`).not.toContain("real-token");
    },
    LONG_TIMEOUT,
  );

  test(
    "a real deploy does not set it and fails with a readable env error",
    async () => {
      strict.clearCalls();
      const result = await cli(strict, ["deploy"]);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Environment validation failed.");
      expect(strict.calls().filter((call) => call.call === "deployCommands")).toEqual([]);
    },
    LONG_TIMEOUT,
  );

  test(
    "a real deploy with a token runs every child without the skip flag",
    async () => {
      const project = fixture({
        config: ENV_CONFIG,
        files: { ...STANDARD_FILES, "src/env.ts": TOKEN_ENV_MODULE },
      });
      const result = await cli(project, ["deploy"], { DISCORD_TOKEN: "real-token" });
      expect(result.code).toBe(0);
      for (const call of project.calls()) expect(call.env.SKIP_ENV_VALIDATION).toBeUndefined();
    },
    LONG_TIMEOUT,
  );

  test(
    "deploy --dry-run needs no token",
    async () => {
      strict.clearCalls();
      const result = await cli(strict, ["deploy", "--dry-run"]);
      expect(result.stderr).toBe("");
      expect(result.code).toBe(0);
      expect(strict.calls().find((call) => call.call === "deployCommands")?.env.SKIP_ENV_VALIDATION).toBe("true");
    },
    LONG_TIMEOUT,
  );
});

import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { createFixture, type Fixture } from "../test-support/fixture.ts";
import {
  findBun,
  findExecutable,
  projectDependsOn,
  readInstalledVersion,
  resolvePackageBin,
  resolveRuntime,
  type RuntimeContext,
} from "./runtime.ts";

const directories: string[] = [];
const fixtures: Fixture[] = [];

function tempBinDirectory(files: string[]): string {
  const directory = mkdtempSync(join(tmpdir(), "neocord bin "));
  directories.push(directory);
  for (const file of files) {
    const path = join(directory, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, "");
    chmodSync(path, 0o755);
  }
  return directory;
}

function context(overrides: Partial<RuntimeContext> & { path?: string; userAgent?: string } = {}): RuntimeContext {
  return {
    bunVersion: overrides.bunVersion,
    execPath: overrides.execPath ?? "/current/runtime",
    platform: overrides.platform ?? "linux",
    env: {
      PATH: overrides.path ?? "",
      ...(overrides.userAgent ? { npm_config_user_agent: overrides.userAgent } : {}),
      ...overrides.env,
    },
  };
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  for (const fixture of fixtures.splice(0)) fixture.cleanup();
});

describe("findBun under bunx", () => {
  test("uses the bun binary next to bunx, because bunx treats a path as a package", () => {
    const directory = tempBinDirectory(["bun", "bunx", "bun.exe", "bunx.exe"]);
    const unix = context({ bunVersion: "1.4.4", execPath: join(directory, "bunx") });
    const windows = context({ bunVersion: "1.4.4", execPath: join(directory, "bunx.exe") });
    expect(findBun(unix)).toBe(join(directory, "bun"));
    expect(findBun(windows)).toBe(join(directory, "bun.exe"));
  });

  test("falls back to PATH when bunx has no sibling", () => {
    const lonely = tempBinDirectory(["bunx"]);
    const onPath = tempBinDirectory(["bun"]);
    const lookup = context({ bunVersion: "1.4.4", execPath: join(lonely, "bunx"), path: onPath });
    expect(findBun(lookup)).toBe(join(onPath, "bun"));
  });

  test("keeps the current binary when it is not bunx", () => {
    expect(findBun(context({ bunVersion: "1.4.4", execPath: "/opt/bun" }))).toBe("/opt/bun");
  });
});

describe("resolveRuntime", () => {
  test("auto picks node when not invoked through bun", () => {
    expect(resolveRuntime("auto", context())).toEqual({
      name: "node",
      command: "/current/runtime",
      args: ["--enable-source-maps"],
    });
  });

  test("auto picks bun when running under bun", () => {
    expect(resolveRuntime("auto", context({ bunVersion: "1.4.4" }))).toEqual({
      name: "bun",
      command: "/current/runtime",
      args: ["--no-env-file"],
    });
  });

  test("auto picks bun when the user agent says bun", () => {
    const directory = tempBinDirectory(["bun"]);
    const resolved = resolveRuntime("auto", context({ path: directory, userAgent: "bun/1.4.4 npm/? node/v22" }));
    expect(resolved.name).toBe("bun");
    expect(resolved.command).toBe(join(directory, "bun"));
  });

  test("auto falls back to node when the user agent says bun but it is missing", () => {
    expect(resolveRuntime("auto", context({ userAgent: "bun/1.4.4" })).name).toBe("node");
  });

  test("ignores other package managers", () => {
    expect(resolveRuntime("auto", context({ userAgent: "npm/10 node/v22" })).name).toBe("node");
  });

  test('explicit "bun" gives a clear error when it is missing', () => {
    expect(() => resolveRuntime("bun", context())).toThrow('runtime: "bun", but bun was not found');
    try {
      resolveRuntime("bun", context());
    } catch (error) {
      expect((error as { hint?: string }).hint).toContain("https://bun.com");
    }
  });

  test('explicit "node" stays on node under bun when node exists', () => {
    const directory = tempBinDirectory(["node"]);
    const resolved = resolveRuntime("node", context({ bunVersion: "1.4.4", path: directory }));
    expect(resolved.name).toBe("node");
    expect(resolved.command).toBe(join(directory, "node"));
  });

  test('explicit "node" gives a clear error under bun when node is missing', () => {
    expect(() => resolveRuntime("node", context({ bunVersion: "1.4.4" }))).toThrow("node was not found");
  });
});

describe("findExecutable", () => {
  test("searches every PATH entry, including ones with spaces", () => {
    const empty = tempBinDirectory([]);
    const directory = tempBinDirectory(["tool"]);
    const path = [empty, directory].join(delimiter);
    expect(findExecutable("tool", context({ path }))).toBe(join(directory, "tool"));
    expect(findExecutable("missing", context({ path }))).toBeNull();
  });

  test.skipIf(process.platform !== "win32")("honours PATHEXT and a differently cased Path on Windows", () => {
    const directory = tempBinDirectory(["tool.EXE", "other.cmd"]);
    const windows: RuntimeContext = {
      bunVersion: undefined,
      execPath: "node.exe",
      platform: "win32",
      env: { Path: directory, PATHEXT: ".EXE;.CMD" },
    };
    expect(findExecutable("tool", windows)?.toLowerCase()).toBe(join(directory, "tool.exe").toLowerCase());
    expect(findExecutable("other", windows)?.toLowerCase()).toBe(join(directory, "other.cmd").toLowerCase());
  });

  test.skipIf(process.platform !== "win32")("resolves an npm bun.cmd shim to its native binary and rejects bare shims", () => {
    const shim = tempBinDirectory(["bun.cmd", "node_modules/bun/bin/bun.exe"]);
    const windows = (path: string): RuntimeContext => ({
      bunVersion: undefined,
      execPath: "node.exe",
      platform: "win32",
      env: { Path: path, PATHEXT: ".EXE;.CMD" },
    });
    expect(findBun(windows(shim))).toBe(join(shim, "node_modules", "bun", "bin", "bun.exe"));
    expect(findBun(windows(tempBinDirectory(["bun.cmd"])))).toBeNull();
  });
});

describe("project packages", () => {
  function projectFixture(): Fixture {
    const fixture = createFixture({
      stubs: false,
      packageJson: { devDependencies: { vitest: "1" }, dependencies: { other: "1" } },
      files: {
        "node_modules/vitest/package.json": JSON.stringify({ name: "vitest", version: "3.1.0", bin: { vitest: "./vitest.mjs" } }),
        "node_modules/vitest/vitest.mjs": "",
        "node_modules/single/package.json": JSON.stringify({ name: "single", bin: "./cli.js" }),
        "node_modules/single/cli.js": "",
        "node_modules/@scope/tool/package.json": JSON.stringify({ name: "@scope/tool", version: "1.2.3", bin: { tsc: "./bin/tsc" } }),
        "node_modules/@scope/tool/bin/tsc": "",
        "node_modules/dangling/package.json": JSON.stringify({ name: "dangling", bin: { dangling: "./nope.js" } }),
      },
    });
    fixtures.push(fixture);
    return fixture;
  }

  test("resolves bins from package metadata, without shims", () => {
    const { root } = projectFixture();
    expect(resolvePackageBin(root, "vitest")).toBe(join(root, "node_modules", "vitest", "./vitest.mjs"));
    expect(resolvePackageBin(root, "single")).toBe(join(root, "node_modules", "single", "cli.js"));
    expect(resolvePackageBin(root, "@scope/tool", "tsc")).toBe(join(root, "node_modules", "@scope", "tool", "bin", "tsc"));
    expect(resolvePackageBin(root, "dangling")).toBeNull();
    expect(resolvePackageBin(root, "missing-package-xyz")).toBeNull();
  });

  test("reads versions and declared dependencies", () => {
    const { root } = projectFixture();
    expect(readInstalledVersion(root, "vitest")).toBe("3.1.0");
    expect(readInstalledVersion(root, "@scope/tool")).toBe("1.2.3");
    expect(readInstalledVersion(root, "missing-package-xyz")).toBeNull();
    expect(projectDependsOn(root, "vitest")).toBe(true);
    expect(projectDependsOn(root, "other")).toBe(true);
    expect(projectDependsOn(root, "single")).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { NeocordStartupError } from "./bot.ts";
import { resolveTotalShards, startManager } from "./manager.ts";

const packageRoot = join(dirname(import.meta.path), "..", "..");

interface ScriptResult {
  scenario: string;
  mode?: string;
  name?: string;
  error?: string;
  hang?: boolean;
  created?: number[];
  values?: unknown[];
  evaluated?: unknown[];
  ids?: number[][];
  counts?: number[];
  stopped?: boolean[];
  totalShards?: number;
  stack?: string;
  survivedRejection?: boolean;
  disposed?: number;
  code?: number;
}

function runScript(script: string, ...args: string[]): { result: ScriptResult; output: string; status: number | null } {
  const { NEOCORD_SHARD_COUNT: _shards, NEOCORD_LOG_LEVEL: _level, ...env } = process.env;
  const spawned = spawnSync(process.execPath, [join("scripts", script), ...args], {
    cwd: packageRoot,
    env: { ...env, NEOCORD_VERIFY_ENTRY: "../src/runtime/index.ts" },
    encoding: "utf8",
    timeout: 100_000,
  });
  const output = `${spawned.stdout}\n${spawned.stderr}`;
  const line = spawned.stdout.split("\n").find((entry) => entry.startsWith("RESULT "));
  if (line === undefined) throw new Error(`No result from ${script} ${args.join(" ")}:\n${output}`);
  return { result: JSON.parse(line.slice(7)) as ScriptResult, output, status: spawned.status };
}

describe("resolveTotalShards", () => {
  test("explicit wins over env, env wins over config", () => {
    expect(resolveTotalShards(3, "2", 1)).toBe(3);
    expect(resolveTotalShards(undefined, "2", 1)).toBe(2);
    expect(resolveTotalShards(undefined, undefined, 1)).toBe(1);
    expect(resolveTotalShards(undefined, "  ", "auto")).toBe("auto");
    expect(resolveTotalShards(undefined, undefined, undefined)).toBe("auto");
  });

  test("a bad env value is a clear error", () => {
    expect(() => resolveTotalShards(undefined, "two", 1)).toThrow('NEOCORD_SHARD_COUNT must be a positive integer, received "two"');
    expect(() => resolveTotalShards(undefined, "0", 1)).toThrow("NEOCORD_SHARD_COUNT");
  });
});

describe("startManager errors in process", () => {
  test("a missing token is an actionable error", async () => {
    const original = process.env.DISCORD_TOKEN;
    const level = process.env.NEOCORD_LOG_LEVEL;
    delete process.env.DISCORD_TOKEN;
    process.env.NEOCORD_LOG_LEVEL = "silent";
    try {
      const failure = startManager({ config: {}, shardFile: "missing.js" });
      await expect(failure).rejects.toBeInstanceOf(NeocordStartupError);
      await expect(failure).rejects.toThrow("No Discord bot token found");
    } finally {
      if (original !== undefined) process.env.DISCORD_TOKEN = original;
      if (level === undefined) delete process.env.NEOCORD_LOG_LEVEL;
      else process.env.NEOCORD_LOG_LEVEL = level;
    }
  });
});

describe.each(["process", "worker"])("sharding on Bun in %s mode", (mode) => {
  test(
    "spawns two shards that answer IPC",
    () => {
      const { result } = runScript("verify-sharding.mjs", "ready", mode);
      expect(result).toMatchObject({
        created: [0, 1],
        values: [42, 42],
        evaluated: [43, 43],
        ids: [[0], [1]],
        counts: [2, 2],
      });
    },
    60_000,
  );

  test(
    "a shard exiting during startup is a clear error",
    () => {
      const { result } = runScript("verify-sharding.mjs", "died", mode);
      expect(result.name).toBe("NeocordStartupError");
      expect(result.error).toContain("exited before its Client became ready");
      expect(result.error).toContain("crashed during startup");
    },
    60_000,
  );

  test(
    "a spawn timeout is a clear error",
    () => {
      const { result } = runScript("verify-sharding.mjs", "timeout", mode);
      expect(result.name).toBe("NeocordStartupError");
      expect(result.error).toContain("sharding.spawnTimeout (1500ms)");
    },
    60_000,
  );

  test(
    "SIGTERM asks shards to stop before exiting",
    () => {
      const { result, status } = runScript("verify-sharding.mjs", "signal", mode);
      expect(result.stopped).toEqual([true, true]);
      expect(status).toBe(0);
    },
    60_000,
  );

  test(
    "NEOCORD_SHARD_COUNT overrides the config",
    () => {
      const { result } = runScript("verify-sharding.mjs", "env", mode);
      expect(result.totalShards).toBe(1);
      expect(result.created).toEqual([0]);
    },
    60_000,
  );
});

describe("startManager and auto deploy", () => {
  test(
    "never attempts or mentions a deploy, because the CLI runs it before the manager",
    () => {
      const { result, output } = runScript("verify-sharding.mjs", "auto-deploy", "process");
      expect(result.created).toEqual([0, 1]);
      expect(output).toContain("All 2 shards are ready");
      const logs = output.split("\n").filter((line) => !line.startsWith("RESULT "));
      expect(logs.join("\n").toLowerCase()).not.toContain("deploy");
    },
    60_000,
  );
});

describe("startBot process handlers", () => {
  test(
    "unhandled rejections do not crash, and repeated signals shut down once",
    () => {
      const { result, status } = runScript("verify-bot.mjs", "signals");
      expect(result).toMatchObject({ survivedRejection: true, disposed: 1, code: 0 });
      expect(status).toBe(0);
    },
    60_000,
  );
});

describe("startBot without Discord credentials", () => {
  test(
    "a missing token fails with the actionable message",
    () => {
      const { result } = runScript("verify-bot.mjs", "missing-token");
      expect(result.error).toContain("No Discord bot token found");
    },
    60_000,
  );

  test(
    "an unreachable API fails with the actionable message and no stack trace",
    () => {
      const { result, output } = runScript("verify-bot.mjs", "offline");
      expect(result.name).toBe("NeocordStartupError");
      expect(result.error).toContain("Could not reach Discord");
      expect(result.stack).toBe(`NeocordStartupError: ${result.error}`);
      expect(output).not.toContain("MTAwMDAwMDAwMDAwMDAwMDAwMA");
    },
    60_000,
  );
});

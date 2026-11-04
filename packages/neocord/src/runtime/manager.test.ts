import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { NeocordStartupError } from "./bot.ts";
import {
  HEALTHY_UPTIME_MS,
  nextRespawnAttempt,
  RESPAWN_BASE_DELAY_MS,
  RESPAWN_MAX_DELAY_MS,
  resolveTotalShards,
  respawnDelay,
  startManager,
} from "./manager.ts";

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
  disposed?: number | boolean | boolean[];
  code?: number;
  status?: number;
  stdout?: string;
  stderr?: string;
  droppedDuringOutage?: number;
  gaps?: number[];
  startsInFiveSeconds?: number;
  otherStarts?: number;
  elapsedMs?: number;
  shardsGone?: boolean;
  managerAlive?: boolean;
  starts?: number[];
  otherReady?: boolean;
  requestsAtFatal?: unknown;
}

function cleanOutputLines(result: ScriptResult): string[] {
  const lines = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.split("\n").filter((line) => line.trim() !== "");
  for (const line of lines) {
    expect(line).not.toContain("NeocordStartupError");
    expect(line).not.toMatch(/^\s+at /);
  }
  return lines.filter((line) => !/ INFO /.test(line));
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

describe("respawn backoff", () => {
  test("doubles from the base delay up to the cap", () => {
    expect(respawnDelay(1)).toBe(RESPAWN_BASE_DELAY_MS);
    expect(respawnDelay(2)).toBe(RESPAWN_BASE_DELAY_MS * 2);
    expect(respawnDelay(3)).toBe(RESPAWN_BASE_DELAY_MS * 4);
    expect(respawnDelay(50)).toBe(RESPAWN_MAX_DELAY_MS);
  });

  test("a shard that was ready long enough starts over, a short lived one does not", () => {
    const now = 1_000_000;
    expect(nextRespawnAttempt(0, null, now)).toBe(1);
    expect(nextRespawnAttempt(5, now - HEALTHY_UPTIME_MS, now)).toBe(1);
    expect(nextRespawnAttempt(5, now - HEALTHY_UPTIME_MS + 1, now)).toBe(6);
    expect(nextRespawnAttempt(5, null, now)).toBe(6);
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

  test(
    "SIGHUP stops shards like SIGTERM",
    () => {
      const { result, status } = runScript("verify-sharding.mjs", "sighup", mode);
      expect(result.stopped).toEqual([true, true]);
      expect(status).toBe(0);
    },
    60_000,
  );

  test(
    "a network failure during a respawn is retried and leaves respawning on for later crashes",
    () => {
      const { result, output } = runScript("verify-sharding.mjs", "network-respawn", mode);
      expect(result).toMatchObject({ recovered: true, laterCrashRespawned: true });
      expect(result.droppedDuringOutage).toBeGreaterThanOrEqual(2);
      expect(output).toContain("Could not reach Discord");
      expect(output).toContain("Respawn attempt 2");
      expect(output).not.toContain("Stopped for good");
    },
    90_000,
  );

  test(
    "fatal close codes after login stop that shard without respawning, and no shards left exits non-zero",
    () => {
      const { result, output, status } = runScript("verify-sharding.mjs", "token-reset", mode);
      expect(status).toBe(1);
      expect(result).toMatchObject({ code: 1, identifies: [1, 1], identifiesAfterFirst: 1, otherAliveAfterFirst: true });
      expect(output.match(/Discord rejected the bot token/g)).toHaveLength(1);
      expect(output.match(/close code 4014/g)).toHaveLength(1);
      expect(output).toContain("No shards are left running");
      expect(output).not.toContain("Respawn attempt");
      expect(output).not.toContain("Authentication failed");
    },
    90_000,
  );

  test(
    "a bad token during a respawn stops that shard only",
    () => {
      const { result, output, status } = runScript("verify-sharding.mjs", "login-fatal-during-respawn", mode);
      expect(status).toBe(0);
      expect(result.requestsAtFatal).toEqual({ firstRunning: false, secondReady: true });
      expect(output).toContain("Stopped for good: Discord rejected the bot token");
      expect(output.match(/Respawn attempt \d+ in/g)).toHaveLength(1);
    },
    90_000,
  );

  test(
    "an uncaught exception in one shard does not take down the manager, and the shard respawns",
    () => {
      const { result, output } = runScript("verify-sharding.mjs", "uncaught-crash", mode);
      expect(result.starts).toEqual([2, 1]);
      expect(result.otherReady).toBe(true);
      expect(output).toContain("boom from shard 0");
    },
    60_000,
  );

  test(
    "a crash loop respawns with growing delays and leaves other shards alone",
    () => {
      const { result } = runScript("verify-sharding.mjs", "crash-loop", mode);
      const gaps = result.gaps ?? [];
      expect(gaps).toHaveLength(3);
      expect(gaps[0]).toBeGreaterThanOrEqual(RESPAWN_BASE_DELAY_MS);
      expect(gaps[1] as number).toBeGreaterThan(gaps[0] as number);
      expect(gaps[2] as number).toBeGreaterThan(gaps[1] as number);
      expect(result.startsInFiveSeconds).toBeLessThanOrEqual(4);
      expect(result.otherStarts).toBe(1);
    },
    60_000,
  );

  test(
    "with respawn off, the manager exits non-zero once no shards remain",
    () => {
      const { result, status } = runScript("verify-sharding.mjs", "no-respawn", mode);
      expect(status).toBe(1);
      expect(result).toMatchObject({ code: 1, starts: [1, 1] });
    },
    60_000,
  );

  test(
    "a shard with a slow task still disposes before the manager gives up on it",
    () => {
      const { result, status } = runScript("verify-sharding.mjs", "slow-stop", mode);
      expect(status).toBe(0);
      expect(result.disposed).toEqual([true, true]);
      expect(result.elapsedMs).toBeGreaterThan(5000);
    },
    60_000,
  );

  test(
    "the shards end when the manager dies",
    () => {
      const { result } = runScript("verify-sharding.mjs", "parent-death", mode);
      expect(result.shardsGone).toBe(true);
      expect(result.managerAlive).toBe(false);
      if (process.platform !== "win32" && mode === "process") expect(result.disposed).toEqual([true, true]);
    },
    60_000,
  );

  test(
    "the IPC shutdown message stops the manager and its shards, and other messages are ignored",
    () => {
      const { result } = runScript("verify-sharding.mjs", "ipc-stop", mode);
      expect(result).toMatchObject({ aliveAfterOtherMessages: true, disposed: [true, true], code: 0 });
    },
    60_000,
  );

  test(
    "a bad token prints one clean message and exits 1 from a generated style entry",
    () => {
      const { result } = runScript("verify-sharding.mjs", "clean-startup-error", mode);
      expect(result.status).toBe(1);
      expect(cleanOutputLines(result)).toEqual([expect.stringContaining("Discord rejected the bot token")]);
    },
    60_000,
  );
});

describe("managed shards in process mode", () => {
  test(
    "a shard that loses its channel to the manager stops and disposes",
    () => {
      const { result } = runScript("verify-sharding.mjs", "manager-disconnect", "process");
      expect(result).toMatchObject({ disposed: true, exits: [0, 0] });
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

  test.each([
    ["clean-bad-token", "Discord rejected the bot token"],
    ["clean-missing-token", "No Discord bot token found"],
    ["clean-offline", "Could not reach Discord"],
  ])(
    "%s prints one clean message and exits 1 from a generated style entry",
    (scenario, message) => {
      const { result } = runScript("verify-bot.mjs", scenario);
      expect(result.status).toBe(1);
      expect(cleanOutputLines(result)).toEqual([expect.stringContaining(message)]);
    },
    60_000,
  );

  test.each([
    [4004, "Discord rejected the bot token"],
    [4014, "close code 4014"],
  ])(
    "gateway close code %i after login logs one actionable error and exits 1",
    (code, message) => {
      const { result } = runScript("verify-bot.mjs", "gateway-close-after-login", String(code));
      expect(result.status).toBe(1);
      const errors = (result.stderr ?? "").split("\n").filter((line) => line.includes("ERROR"));
      expect(errors).toEqual([expect.stringContaining(message)]);
      expect(result.stderr).not.toContain("    at ");
    },
    60_000,
  );
});

describe("startBot graceful stop protocol", () => {
  test(
    "the IPC shutdown message stops the bot, and other messages are ignored",
    () => {
      const { result } = runScript("verify-bot.mjs", "ipc-stop");
      expect(result).toMatchObject({ aliveAfterOtherMessages: true, disposed: 1, code: 0 });
      expect(result.stderr).toBe("");
    },
    60_000,
  );

  test(
    "the channel does not keep the process alive once the bot has stopped",
    () => {
      const { result } = runScript("verify-bot.mjs", "ipc-natural");
      expect(result.hang).toBeUndefined();
      expect(result).toMatchObject({ code: 0, during: 1 });
    },
    60_000,
  );

  test(
    "no process message listener is added without a channel",
    () => {
      const { result } = runScript("verify-bot.mjs", "no-channel-listeners");
      expect(result).toMatchObject({ hasSend: false, before: 0, during: 0, after: 0 });
    },
    60_000,
  );

  test(
    "a second SIGTERM during dispose is ignored",
    () => {
      const { result, status } = runScript("verify-bot.mjs", "second-signal");
      expect(status).toBe(0);
      expect(result).toMatchObject({ disposed: 1, code: 0, listenersDuringDispose: 1 });
    },
    60_000,
  );

  test(
    "a later second SIGINT forces an exit",
    () => {
      const { result, status } = runScript("verify-bot.mjs", "force-sigint");
      expect(status).toBe(130);
      expect(result).toMatchObject({ disposed: 0, code: 130 });
    },
    60_000,
  );
});

import { describe, expect, test } from "bun:test";
import type { Client } from "discord.js";
import { defineEvent, defineTask } from "../index.ts";
import { createLogger, type LogMethod } from "../logger.ts";
import type { BaseContext, TaskInput } from "../types.ts";
import { createEventHandler, createBaseContext } from "./dispatch.tsx";
import type { CompiledRoute } from "./manifest.ts";
import { createShardHelpers } from "./shards.ts";
import { createTaskRunner, shouldRunOnThisShard } from "./tasks.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fakeClient(shardIds: number[] | null): Client<true> {
  return { shard: shardIds === null ? null : { ids: shardIds, count: 2 } } as unknown as Client<true>;
}

function taskRoute(input: TaskInput): CompiledRoute<"task"> {
  return {
    kind: "task",
    id: "core/job",
    feature: "core",
    file: "job.ts",
    segments: ["job"],
    definition: defineTask(input),
    middleware: [],
    layouts: [],
    error: null,
    loading: null,
    permissions: [],
    guildOnly: false,
    cooldownMs: null,
  };
}

function runner(route: CompiledRoute<"task">, client = fakeClient(null)) {
  const logs: { level: LogMethod; line: string }[] = [];
  const logger = createLogger({ level: "debug", sink: (level, line) => logs.push({ level, line }) });
  const tasks = createTaskRunner({
    tasks: [route],
    client,
    logger,
    createContext: (compiled) => ({ route: compiled.id }) as BaseContext,
  });
  return { tasks, logs };
}

describe("task runner", () => {
  test("runs on the interval and stops", async () => {
    let runs = 0;
    const { tasks } = runner(
      taskRoute({
        every: 5,
        execute: () => {
          runs += 1;
        },
      }),
    );
    tasks.start();
    await sleep(30);
    await tasks.stop();
    const count = runs;
    expect(count).toBeGreaterThan(1);
    await sleep(15);
    expect(runs).toBe(count);
  });

  test("runOnStart runs immediately, otherwise waits", async () => {
    let immediate = 0;
    const first = runner(
      taskRoute({
        every: "1h",
        runOnStart: true,
        execute: () => {
          immediate += 1;
        },
      }),
    );
    first.tasks.start();
    await first.tasks.stop();
    expect(immediate).toBe(1);

    let waiting = 0;
    const second = runner(
      taskRoute({
        every: "1h",
        execute: () => {
          waiting += 1;
        },
      }),
    );
    second.tasks.start();
    await second.tasks.stop();
    expect(waiting).toBe(0);
  });

  test("overlapping runs are skipped", async () => {
    let active = 0;
    let peak = 0;
    let runs = 0;
    const { tasks, logs } = runner(
      taskRoute({
        every: 3,
        async execute() {
          runs += 1;
          active += 1;
          peak = Math.max(peak, active);
          await sleep(25);
          active -= 1;
        },
      }),
    );
    tasks.start();
    await sleep(40);
    await tasks.stop();
    expect(peak).toBe(1);
    expect(runs).toBeLessThanOrEqual(2);
    expect(logs.some((entry) => entry.line.includes("still in progress"))).toBe(true);
  });

  test("errors are logged and the task keeps running", async () => {
    let runs = 0;
    const { tasks, logs } = runner(
      taskRoute({
        every: 5,
        execute: () => {
          runs += 1;
          throw new Error("task broke");
        },
      }),
    );
    tasks.start();
    await sleep(25);
    await tasks.stop();
    expect(runs).toBeGreaterThan(1);
    expect(logs.some((entry) => entry.level === "error" && entry.line.includes("task broke"))).toBe(true);
  });

  test('shard: "first" honours client.shard.ids', () => {
    const first = defineTask({ every: "1h", shard: "first", execute: () => undefined });
    const fallback = defineTask({ every: "1h", execute: () => undefined });
    const all = defineTask({ every: "1h", shard: "all", execute: () => undefined });
    expect(shouldRunOnThisShard(first, fakeClient(null))).toBe(true);
    expect(shouldRunOnThisShard(first, fakeClient([0]))).toBe(true);
    expect(shouldRunOnThisShard(first, fakeClient([1]))).toBe(false);
    expect(shouldRunOnThisShard(fallback, fakeClient([1]))).toBe(false);
    expect(shouldRunOnThisShard(all, fakeClient([1]))).toBe(true);
  });

  test("a shard-filtered task never starts", async () => {
    let runs = 0;
    const { tasks } = runner(
      taskRoute({
        every: 2,
        runOnStart: true,
        shard: "first",
        execute: () => {
          runs += 1;
        },
      }),
      fakeClient([1]),
    );
    tasks.start();
    await sleep(15);
    await tasks.stop();
    expect(runs).toBe(0);
  });

  test("stop waits for a run in progress", async () => {
    let finished = false;
    const { tasks } = runner(
      taskRoute({
        every: "1h",
        runOnStart: true,
        async execute() {
          await sleep(15);
          finished = true;
        },
      }),
    );
    tasks.start();
    await tasks.stop();
    expect(finished).toBe(true);
    expect(tasks.active).toBe(0);
  });
});

describe("event handlers", () => {
  function eventRoute(execute: (...args: never[]) => unknown): CompiledRoute<"event"> {
    return {
      kind: "event",
      id: "guildCreate",
      feature: "core",
      file: "guildCreate.ts",
      segments: ["guildCreate"],
      definition: defineEvent("guildCreate", { execute: execute as never }) as never,
      middleware: [],
      layouts: [],
      error: null,
      loading: null,
      permissions: [],
      guildOnly: false,
      cooldownMs: null,
    };
  }

  function deps() {
    const logs: { level: LogMethod; line: string }[] = [];
    const client = fakeClient(null);
    return {
      logs,
      options: {
        client,
        app: {} as never,
        logger: createLogger({ level: "debug", sink: (level, line) => logs.push({ level, line }) }),
        shards: createShardHelpers(client),
      },
    };
  }

  test("receive the context and arguments", async () => {
    const seen: unknown[] = [];
    const { options } = deps();
    const handler = createEventHandler(
      eventRoute((...args: unknown[]) => {
        seen.push(...args);
      }),
      options,
    );
    await handler("guild-object");
    expect((seen[0] as BaseContext).route).toBe("guildCreate");
    expect((seen[0] as BaseContext).feature).toBe("core");
    expect(seen[1]).toBe("guild-object");
  });

  test("sync and async errors are isolated and logged", async () => {
    const { options, logs } = deps();
    const syncHandler = createEventHandler(
      eventRoute(() => {
        throw new Error("sync event error");
      }),
      options,
    );
    const asyncHandler = createEventHandler(
      eventRoute(async () => {
        await Promise.resolve();
        throw new Error("async event error");
      }),
      options,
    );
    await expect(syncHandler()).resolves.toBeUndefined();
    await expect(asyncHandler()).resolves.toBeUndefined();
    const errors = logs.filter((entry) => entry.level === "error").map((entry) => entry.line).join("\n");
    expect(errors).toContain("sync event error");
    expect(errors).toContain("async event error");
    expect(errors).toContain("guildCreate.ts");
  });

  test("createBaseContext scopes the logger to the route", () => {
    const { options, logs } = deps();
    const ctx = createBaseContext(options, { id: "core/thing", feature: "core" });
    ctx.logger.info("hello");
    expect(logs[0]?.line).toContain("[core/thing] hello");
  });
});

describe("shard helpers", () => {
  test("use the shard utility when there is one", async () => {
    const calls: unknown[] = [];
    const client = {
      shard: {
        ids: [1],
        count: 4,
        fetchClientValues: async (prop: string) => {
          calls.push(prop);
          return [1, 2];
        },
        broadcastEval: async (_fn: unknown, options: unknown) => {
          calls.push(options);
          return ["a", "b"];
        },
      },
    } as unknown as Client<true>;
    const helpers = createShardHelpers(client);
    expect(helpers.id).toBe(1);
    expect(helpers.ids).toEqual([1]);
    expect(helpers.count).toBe(4);
    expect(await helpers.fetchClientValues<number>("guilds.cache.size")).toEqual([1, 2]);
    expect(await helpers.broadcastEval(() => "x", { context: { n: 1 } })).toEqual(["a", "b"]);
    expect(calls).toEqual(["guilds.cache.size", { context: { n: 1 } }]);
  });

  test("fall back to the local client and serialize like IPC", async () => {
    const client = { shard: null, guilds: { size: 3 }, when: new Date(0) } as unknown as Client<true>;
    const helpers = createShardHelpers(client);
    expect(helpers.id).toBe(0);
    expect(helpers.ids).toEqual([0]);
    expect(helpers.count).toBe(1);
    expect(await helpers.fetchClientValues<number>("guilds.size")).toEqual([3]);
    expect(await helpers.broadcastEval(() => new Date(0))).toEqual([new Date(0).toISOString()] as never);
    expect(await helpers.broadcastEval(() => undefined)).toEqual([undefined] as never);
    expect(await helpers.broadcastEval((_client, context) => context.value * 2, { context: { value: 21 } })).toEqual([42]);
  });
});

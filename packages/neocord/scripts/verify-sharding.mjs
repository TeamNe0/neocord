import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { startFakeDiscord } from "./fake-discord.mjs";

const scenario = process.argv[2] ?? "ready";
const mode = process.argv[3] ?? "process";
const here = import.meta.dirname;
const entry = pathToFileURL(resolve(here, process.env.NEOCORD_VERIFY_ENTRY ?? "../dist/runtime/index.js")).href;
const botUrl = new URL(entry.endsWith(".ts") ? "./bot.ts" : "./bot.js", entry).href;
const discordUrl = pathToFileURL(createRequire(import.meta.url).resolve("discord.js")).href;
const directory = process.env.NEOCORD_VERIFY_DIR ?? mkdtempSync(join(tmpdir(), "neocord-shards-"));
const marker = (name) => join(directory, name).replaceAll("\\", "/");
const DUMMY = "MTAwMDAwMDAwMDAwMDAwMDAwMA.GAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

function report(value) {
  process.stdout.write(`RESULT ${JSON.stringify(value)}\n`);
}

function cleanupAndExit(code) {
  rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  process.exit(code);
}

async function waitFor(condition, label, limit = 30_000) {
  const startedAt = Date.now();
  while (!condition()) {
    if (Date.now() - startedAt > limit) throw new Error(`Timed out waiting for ${label}.`);
    await new Promise((done) => setTimeout(done, 25));
  }
}

const readyShard = `
import { writeFileSync } from "node:fs";
import { parentPort } from "node:worker_threads";
import { Client } from ${JSON.stringify(discordUrl)};
const client = new Client({ intents: [] });
client.answer = 42;
const onMessage = (message) => {
  if (message && message.__neocordShutdown) {
    writeFileSync(${JSON.stringify(marker("stopped"))} + "-" + client.options.shards[0], "stopped");
    process.exit(0);
  }
};
(parentPort ?? process).on("message", onMessage);
client.emit("shardReady", client.options.shards[0], new Set());
setInterval(() => {}, 1000);
`;

const shardHeader = `
import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import { Client } from ${JSON.stringify(discordUrl)};
const id = Number((workerData ?? process.env).SHARDS);
appendFileSync(${JSON.stringify(marker("starts"))} + "-" + id, Date.now() + "\\n");
writeFileSync(${JSON.stringify(marker("pid"))} + "-" + id, String(process.pid));
`;

const uncaughtShard = `${shardHeader}
const client = new Client({ intents: [] });
const first = !existsSync(${JSON.stringify(marker("crashed"))} + "-" + id);
client.emit("shardReady", id, new Set());
if (id === 0 && first) {
  writeFileSync(${JSON.stringify(marker("crashed"))} + "-" + id, "crashed");
  setTimeout(() => {
    throw new Error("boom from shard " + id);
  }, 100);
}
setInterval(() => {}, 1000);
`;

const crashLoopShard = `${shardHeader}
const client = new Client({ intents: [] });
client.emit("shardReady", id, new Set());
if (id === 0) setTimeout(() => process.exit(3), 50);
setInterval(() => {}, 1000);
`;

const exitAfterReadyShard = `${shardHeader}
const client = new Client({ intents: [] });
client.emit("shardReady", id, new Set());
setTimeout(() => process.exit(0), 200 + id * 200);
setInterval(() => {}, 1000);
`;

const realBotShard = (api, options = "") => `
import { startBot } from ${JSON.stringify(entry)};
const manifest = { version: 1, context: null, features: [], groups: [], routes: [] };
await startBot({
  config: { token: ${JSON.stringify(DUMMY)}, logLevel: "error", client: { rest: { api: ${JSON.stringify(api)}, retries: 0, timeout: 1500 } } ${options} },
  manifest,
});
`;

const fakeLoginBotShard = (routes = "[]") => `${shardHeader}
const { startBotWith } = await import(${JSON.stringify(botUrl)});
const context = {
  __neocord: "context",
  factory: () => ({
    value: {},
    dispose: () => writeFileSync(${JSON.stringify(marker("disposed"))} + "-" + id, "disposed"),
  }),
};
const manifest = { version: 1, context: { default: context }, features: [], groups: [], routes: ${routes} };
await startBotWith(
  { config: { token: ${JSON.stringify(DUMMY)}, logLevel: "error" }, manifest },
  {
    createClient: (options) => {
      const client = new Client(options);
      client.login = async () => {
        queueMicrotask(() => {
          client.emit("shardReady", id, new Set());
          client.emit("clientReady", client);
        });
        return ${JSON.stringify(DUMMY)};
      };
      return client;
    },
  },
);
setInterval(() => {}, 1000);
`;

const slowTaskRoutes = `[{
  kind: "task",
  id: "core/slow",
  feature: "core",
  file: "slow.ts",
  segments: ["slow"],
  module: {
    default: {
      __neocord: "task",
      every: "1h",
      runOnStart: true,
      shard: "all",
      execute: () => new Promise((done) => setTimeout(done, 6000)),
    },
  },
  middleware: [],
  layouts: [],
  error: null,
  loading: null,
}]`;

const shards = {
  ready: () => readyShard,
  signal: () => readyShard,
  sighup: () => readyShard,
  env: () => readyShard,
  "auto-deploy": () => readyShard,
  died: () => `process.exit(3);`,
  timeout: () => `setInterval(() => {}, 1000);`,
  "uncaught-crash": () => uncaughtShard,
  "crash-loop": () => crashLoopShard,
  "no-respawn": () => exitAfterReadyShard,
  "slow-stop": () => fakeLoginBotShard(slowTaskRoutes),
  "parent-death-child": () => fakeLoginBotShard(),
  "manager-disconnect": () => fakeLoginBotShard(),
  "ipc-stop-child": () => fakeLoginBotShard(),
};

const shardFile = join(directory, "shard.mjs");
if (shards[scenario] !== undefined) writeFileSync(shardFile, shards[scenario]());

if (scenario === "auto-deploy") process.env.NODE_ENV = "production";

const { startManager } = await import(entry);

const config = {
  token: DUMMY,
  logLevel: scenario === "auto-deploy" ? "debug" : "error",
  ...(scenario === "auto-deploy" ? { deploy: { mode: "auto" } } : {}),
  sharding: {
    totalShards: 2,
    mode,
    respawn: scenario !== "died" && scenario !== "no-respawn",
    spawnDelay: 50,
    spawnTimeout: scenario === "timeout" ? 1500 : 60_000,
  },
};

const guard = setTimeout(() => {
  report({ scenario, mode, hang: true });
  cleanupAndExit(70);
}, 120_000);
guard.unref();

const killChild = (shard) => {
  if (shard.process !== null) shard.process.kill();
  else void shard.worker?.terminate();
};

function startsOf(id) {
  const file = `${marker("starts")}-${id}`;
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n").map(Number) : [];
}

function reportOnExit(values) {
  process.on("exit", (code) => {
    report({ scenario, mode, code, ...values() });
    rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  });
}

async function runDriver(childScenario, act) {
  const child = spawn(process.execPath, [join(here, "verify-sharding.mjs"), childScenario, mode], {
    env: { ...process.env, NEOCORD_VERIFY_DIR: directory },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  const exited = new Promise((done) => {
    child.on("exit", (code, signal) => done({ code, signal }));
  });
  await waitFor(() => existsSync(marker("manager-ready")), "the child manager", 60_000);
  await act(child, exited);
  return { ...(await exited), output };
}

async function childManager() {
  await startManager({ config, shardFile: pathToFileURL(shardFile) });
  writeFileSync(marker("manager-ready"), String(process.pid));
  await new Promise(() => undefined);
}

try {
  if (scenario === "env") {
    process.env.NEOCORD_SHARD_COUNT = "1";
    const manager = await startManager({ config: { ...config, sharding: { ...config.sharding, totalShards: 2 } }, shardFile });
    report({ scenario, mode, totalShards: manager.totalShards, created: [...manager.shards.keys()] });
    for (const shard of manager.shards.values()) shard.kill();
    cleanupAndExit(0);
  }

  if (scenario === "parent-death-child" || scenario === "ipc-stop-child") await childManager();

  if (scenario === "parent-death") {
    const isAlive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const pidOf = (name) => Number(readFileSync(marker(name), "utf8"));
    const finished = await runDriver("parent-death-child", async (child) => {
      await waitFor(() => existsSync(`${marker("pid")}-0`) && existsSync(`${marker("pid")}-1`), "the shard pids");
      child.kill("SIGKILL");
    });
    const pids = [pidOf("pid-0"), pidOf("pid-1")];
    await waitFor(() => !pids.some(isAlive), "the shards to end after the manager died", 20_000);
    report({
      scenario,
      mode,
      shardsGone: true,
      disposed: [existsSync(`${marker("disposed")}-0`), existsSync(`${marker("disposed")}-1`)],
      managerAlive: isAlive(pidOf("manager-ready")),
      managerSignal: finished.signal,
    });
    cleanupAndExit(0);
  }

  if (scenario === "manager-disconnect") {
    const manager = await startManager({ config, shardFile: pathToFileURL(shardFile) });
    const disposedAll = () => existsSync(`${marker("disposed")}-0`) && existsSync(`${marker("disposed")}-1`);
    const exits = [];
    for (const shard of manager.shards.values()) {
      shard.process.once("exit", (code) => exits.push(code));
      shard.process.disconnect();
    }
    await waitFor(() => disposedAll() && exits.length === 2, "the shards to stop after losing the channel", 20_000);
    report({ scenario, mode, disposed: disposedAll(), exits });
    cleanupAndExit(0);
  }

  if (scenario === "ipc-stop") {
    let aliveAfterOtherMessages = false;
    const finished = await runDriver("ipc-stop-child", async (child) => {
      child.send({ neocord: "other" });
      child.send({ neocord: "shutdown", extra: true });
      child.send("shutdown");
      await new Promise((done) => setTimeout(done, 500));
      aliveAfterOtherMessages =
        child.exitCode === null && !existsSync(`${marker("disposed")}-0`) && !existsSync(`${marker("disposed")}-1`);
      child.send({ neocord: "shutdown" });
    });
    report({
      scenario,
      mode,
      aliveAfterOtherMessages,
      disposed: [existsSync(`${marker("disposed")}-0`), existsSync(`${marker("disposed")}-1`)],
      code: finished.code,
    });
    cleanupAndExit(0);
  }

  if (scenario === "clean-startup-error") {
    const fake = await startFakeDiscord();
    fake.http = "unauthorized";
    writeFileSync(shardFile, realBotShard(fake.api));
    const managerEntry = join(directory, "manager.mjs");
    writeFileSync(
      managerEntry,
      `import { startManager } from ${JSON.stringify(entry)};
await startManager({
  config: { token: ${JSON.stringify(DUMMY)}, logLevel: "warn", sharding: { totalShards: 2, mode: ${JSON.stringify(mode)}, spawnDelay: 50, spawnTimeout: 20000 } },
  shardFile: new URL("./shard.mjs", import.meta.url),
});
`,
    );
    const child = spawn(process.execPath, [managerEntry], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    const status = await new Promise((done) => child.on("close", done));
    await fake.close();
    report({ scenario, mode, status, stdout, stderr });
    cleanupAndExit(0);
  }

  if (scenario === "network-respawn") {
    const fake = await startFakeDiscord();
    writeFileSync(shardFile, realBotShard(fake.api));
    const manager = await startManager({
      config: { ...config, logLevel: "warn", sharding: { ...config.sharding, spawnTimeout: 20_000 } },
      shardFile: pathToFileURL(shardFile),
    });
    const [first, second] = [manager.shards.get(0), manager.shards.get(1)];

    fake.http = "drop";
    killChild(first);
    await waitFor(() => fake.dropped >= 2, "two failed respawn attempts");
    const droppedDuringOutage = fake.dropped;
    fake.http = "ok";
    await waitFor(() => first.ready, "shard 0 to recover");

    const secondIdentifies = fake.identifies.get(1);
    killChild(second);
    await waitFor(() => second.ready && fake.identifies.get(1) > secondIdentifies, "shard 1 to respawn after the outage");

    await fake.close();
    report({ scenario, mode, droppedDuringOutage, recovered: first.ready, laterCrashRespawned: second.ready });
    for (const shard of manager.shards.values()) shard.kill();
    cleanupAndExit(0);
  }

  if (scenario === "token-reset") {
    const fake = await startFakeDiscord();
    writeFileSync(shardFile, realBotShard(fake.api));
    const manager = await startManager({
      config: { ...config, logLevel: "warn", sharding: { ...config.sharding, spawnTimeout: 20_000 } },
      shardFile: pathToFileURL(shardFile),
    });
    let identifiesAfterFirst = null;
    let otherAliveAfterFirst = null;
    reportOnExit(() => ({
      identifies: [fake.identifies.get(0), fake.identifies.get(1)],
      identifiesAfterFirst,
      otherAliveAfterFirst,
    }));
    const [first, second] = [manager.shards.get(0), manager.shards.get(1)];
    fake.closeShard(0, 4004);
    await waitFor(() => first.process === null && first.worker === null, "shard 0 to exit");
    await new Promise((done) => setTimeout(done, 2500));
    identifiesAfterFirst = fake.identifies.get(0);
    otherAliveAfterFirst = second.ready;
    fake.closeShard(1, 4014);
    await new Promise(() => undefined);
  }

  if (scenario === "login-fatal-during-respawn") {
    const fake = await startFakeDiscord();
    writeFileSync(shardFile, realBotShard(fake.api));
    const manager = await startManager({
      config: { ...config, logLevel: "warn", sharding: { ...config.sharding, spawnTimeout: 20_000 } },
      shardFile: pathToFileURL(shardFile),
    });
    const [first, second] = [manager.shards.get(0), manager.shards.get(1)];
    let requestsAtFatal = null;
    fake.http = "unauthorized";
    reportOnExit(() => ({ requestsAtFatal, secondReady: second.ready }));
    killChild(first);
    await new Promise((done) => setTimeout(done, 5000));
    requestsAtFatal = { firstRunning: first.process !== null || first.worker !== null, secondReady: second.ready };
    await fake.close();
    process.emit("SIGTERM");
    await new Promise(() => undefined);
  }

  const manager = await startManager({ config, shardFile: pathToFileURL(shardFile) });

  if (scenario === "signal" || scenario === "sighup") {
    process.on("exit", () => {
      const stopped = [existsSync(`${marker("stopped")}-0`), existsSync(`${marker("stopped")}-1`)];
      report({ scenario, mode, stopped });
      rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
    });
    process.emit(scenario === "sighup" ? "SIGHUP" : "SIGTERM");
  } else if (scenario === "slow-stop") {
    const startedAt = Date.now();
    reportOnExit(() => ({
      disposed: [existsSync(`${marker("disposed")}-0`), existsSync(`${marker("disposed")}-1`)],
      elapsedMs: Date.now() - startedAt,
    }));
    await new Promise((done) => setTimeout(done, 200));
    process.emit("SIGTERM");
  } else if (scenario === "uncaught-crash") {
    const first = manager.shards.get(0);
    await waitFor(() => startsOf(0).length >= 2 && first.ready, "shard 0 to respawn after the uncaught error");
    report({ scenario, mode, starts: [startsOf(0).length, startsOf(1).length], otherReady: manager.shards.get(1).ready });
    for (const shard of manager.shards.values()) shard.kill();
    cleanupAndExit(0);
  } else if (scenario === "crash-loop") {
    await waitFor(() => startsOf(0).length >= 4, "the crash loop to respawn three times");
    const starts = startsOf(0);
    const gaps = starts.slice(1).map((time, index) => time - starts[index]);
    const startsInFiveSeconds = starts.filter((time) => time - starts[0] <= 5000).length;
    report({ scenario, mode, gaps, startsInFiveSeconds, otherStarts: startsOf(1).length });
    for (const shard of manager.shards.values()) shard.kill();
    cleanupAndExit(0);
  } else if (scenario === "no-respawn") {
    reportOnExit(() => ({ starts: [startsOf(0).length, startsOf(1).length] }));
    await new Promise(() => undefined);
  } else {
    const values = await manager.fetchClientValues("answer");
    const evaluated = await manager.broadcastEval((client, context) => client.answer + context.n, { context: { n: 1 } });
    const ids = await manager.broadcastEval((client) => client.shard.ids);
    const counts = await manager.broadcastEval((client) => client.shard.count);
    report({ scenario, mode, created: [...manager.shards.keys()], values, evaluated, ids, counts });
    for (const shard of manager.shards.values()) shard.kill();
    cleanupAndExit(0);
  }
} catch (error) {
  report({ scenario, mode, name: error?.name, error: error?.message });
  cleanupAndExit(0);
}

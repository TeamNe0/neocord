import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const scenario = process.argv[2] ?? "ready";
const mode = process.argv[3] ?? "process";
const here = import.meta.dirname;
const entry = pathToFileURL(resolve(here, process.env.NEOCORD_VERIFY_ENTRY ?? "../dist/runtime/index.js")).href;
const discordUrl = pathToFileURL(createRequire(import.meta.url).resolve("discord.js")).href;
const directory = mkdtempSync(join(tmpdir(), "neocord-shards-"));
const marker = (name) => join(directory, name).replaceAll("\\", "/");

function report(value) {
  process.stdout.write(`RESULT ${JSON.stringify(value)}\n`);
}

function cleanupAndExit(code) {
  rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
  process.exit(code);
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

const realBotShard = `
import { startBot } from ${JSON.stringify(entry)};
const manifest = { version: 1, context: null, features: [], groups: [], routes: [] };
await startBot({
  config: { token: "MTAwMDAwMDAwMDAwMDAwMDAwMA.GAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", logLevel: "error" },
  manifest,
}).catch(() => process.exit(1));
`;

const shards = {
  ready: readyShard,
  signal: readyShard,
  env: readyShard,
  "auto-deploy": readyShard,
  died: `process.exit(3);`,
  timeout: `setInterval(() => {}, 1000);`,
  "real-bot": realBotShard,
};

const shardFile = join(directory, "shard.mjs");
writeFileSync(shardFile, shards[scenario]);

if (scenario === "auto-deploy") process.env.NODE_ENV = "production";

const { startManager } = await import(entry);

const config = {
  token: "MTAwMDAwMDAwMDAwMDAwMDAwMA.GAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  logLevel: scenario === "auto-deploy" ? "debug" : "error",
  ...(scenario === "auto-deploy" ? { deploy: { mode: "auto" } } : {}),
  sharding: {
    totalShards: 2,
    mode,
    respawn: scenario !== "died",
    spawnDelay: 50,
    spawnTimeout: scenario === "timeout" ? 1500 : 60_000,
  },
};

const guard = setTimeout(() => {
  report({ scenario, mode, hang: true });
  cleanupAndExit(70);
}, 120_000);
guard.unref();

try {
  if (scenario === "env") {
    process.env.NEOCORD_SHARD_COUNT = "1";
    const manager = await startManager({ config: { ...config, sharding: { ...config.sharding, totalShards: 2 } }, shardFile });
    report({ scenario, mode, totalShards: manager.totalShards, created: [...manager.shards.keys()] });
    for (const shard of manager.shards.values()) shard.kill();
    cleanupAndExit(0);
  }

  const manager = await startManager({ config, shardFile: pathToFileURL(shardFile) });

  if (scenario === "signal") {
    process.on("exit", () => {
      const stopped = [existsSync(`${marker("stopped")}-0`), existsSync(`${marker("stopped")}-1`)];
      report({ scenario, mode, stopped });
      rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
    });
    process.emit("SIGTERM");
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

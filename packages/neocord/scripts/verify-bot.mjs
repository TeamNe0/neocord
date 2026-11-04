import { fork, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startFakeDiscord } from "./fake-discord.mjs";

const scenario = process.argv[2] ?? "dummy";
const here = import.meta.dirname;
const entry = pathToFileURL(resolve(here, process.env.NEOCORD_VERIFY_ENTRY ?? "../dist/runtime/index.js")).href;
const { startBot } = await import(entry);

const DUMMY = "MTAwMDAwMDAwMDAwMDAwMDAwMA.GAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const manifest = { version: 1, context: null, features: [], groups: [], routes: [] };

const configs = {
  dummy: { token: DUMMY, logLevel: "error" },
  offline: {
    token: DUMMY,
    logLevel: "error",
    client: { rest: { api: "http://127.0.0.1:9/api", timeout: 2000, retries: 1 } },
  },
  "missing-token": { logLevel: "error" },
};

if (scenario === "missing-token") delete process.env.DISCORD_TOKEN;

function reportResult(value) {
  process.stdout.write(`RESULT ${JSON.stringify({ scenario, ...value })}\n`);
}

function sleep(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

async function startFakeLoginBot({ disposeMs = 0, onDispose = () => undefined } = {}) {
  const { Client } = await import("discord.js");
  const { startBotWith } = await import(new URL(entry.endsWith(".ts") ? "./bot.ts" : "./bot.js", entry).href);
  const context = {
    __neocord: "context",
    factory: () => ({
      value: {},
      dispose: async () => {
        await sleep(disposeMs);
        onDispose();
      },
    }),
  };
  return startBotWith(
    { config: { token: DUMMY, logLevel: "silent" }, manifest: { ...manifest, context: { default: context } } },
    {
      createClient: (options) => {
        const client = new Client(options);
        client.login = async () => DUMMY;
        return client;
      },
    },
  );
}

async function runEntry(source, env = process.env) {
  const directory = mkdtempSync(join(tmpdir(), "neocord-bot-"));
  const file = join(directory, "entry.mjs");
  writeFileSync(file, source);
  const child = spawn(process.execPath, [file], { env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const status = new Promise((done) => {
    child.on("close", (code) => done(code));
  });
  return {
    child,
    finished: status.then((code) => {
      rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
      return { status: code, stdout, stderr };
    }),
  };
}

const entrySource = (api, token = DUMMY) => `
import { startBot } from ${JSON.stringify(entry)};
const manifest = { version: 1, context: null, features: [], groups: [], routes: [] };
await startBot({
  config: { ${token === null ? "" : `token: ${JSON.stringify(token)},`} logLevel: "info", client: { rest: { api: ${JSON.stringify(api)}, retries: 0, timeout: 1500 } } },
  manifest,
});
`;

if (scenario === "clean-bad-token") {
  const fake = await startFakeDiscord();
  fake.http = "unauthorized";
  const { finished } = await runEntry(entrySource(fake.api));
  const result = await finished;
  await fake.close();
  reportResult(result);
  process.exit(0);
}

if (scenario === "clean-missing-token") {
  const { DISCORD_TOKEN: _token, ...env } = process.env;
  const { finished } = await runEntry(entrySource("http://127.0.0.1:9/api", null), env);
  reportResult(await finished);
  process.exit(0);
}

if (scenario === "clean-offline") {
  const { finished } = await runEntry(entrySource("http://127.0.0.1:9/api"));
  reportResult(await finished);
  process.exit(0);
}

if (scenario === "gateway-close-after-login") {
  const fake = await startFakeDiscord();
  const { finished } = await runEntry(entrySource(fake.api));
  const startedAt = Date.now();
  while (fake.identifies.size === 0 && Date.now() - startedAt < 30_000) await sleep(25);
  await sleep(300);
  fake.closeShard(0, Number(process.argv[3] ?? 4004));
  const result = await finished;
  await fake.close();
  reportResult(result);
  process.exit(0);
}

if (scenario === "second-signal") {
  let disposed = 0;
  await startFakeLoginBot({
    disposeMs: 300,
    onDispose: () => {
      disposed += 1;
    },
  });
  let listenersDuringDispose = -1;
  process.on("exit", (code) => {
    reportResult({ disposed, code, listenersDuringDispose });
  });
  process.emit("SIGTERM");
  await sleep(100);
  listenersDuringDispose = process.listenerCount("SIGTERM");
  process.emit("SIGTERM");
  await sleep(5000);
  process.exit(9);
}

if (scenario === "force-sigint") {
  let disposed = 0;
  await startFakeLoginBot({
    disposeMs: 6000,
    onDispose: () => {
      disposed += 1;
    },
  });
  process.on("exit", (code) => {
    reportResult({ disposed, code });
  });
  process.emit("SIGINT");
  await sleep(1200);
  process.emit("SIGINT");
  await sleep(8000);
  process.exit(9);
}

if (scenario === "no-channel-listeners") {
  const before = process.listenerCount("message");
  const bot = await startFakeLoginBot();
  const during = process.listenerCount("message");
  await bot.stop();
  reportResult({ hasSend: typeof process.send === "function", before, during, after: process.listenerCount("message") });
  process.exit(0);
}

if (scenario === "ipc-child") {
  await startFakeLoginBot({ onDispose: () => process.send?.({ disposed: true }) });
  process.send?.({ started: true });
  setInterval(() => undefined, 1000);
}

if (scenario === "ipc-natural-child") {
  const bot = await startFakeLoginBot();
  process.send?.({ started: true, during: process.listenerCount("message") });
  await bot.stop();
}

if (scenario === "ipc-stop" || scenario === "ipc-natural") {
  const childScenario = `${scenario}-child`.replace("ipc-stop-child", "ipc-child");
  const child = fork(fileURLToPath(import.meta.url), [childScenario], { stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const messages = [];
  child.on("message", (message) => messages.push(message));
  const exit = new Promise((done) => {
    child.on("exit", (code, signal) => done({ code, signal }));
  });
  const startedAt = Date.now();
  while (!messages.some((message) => message.started) && Date.now() - startedAt < 30_000) await sleep(25);
  if (scenario === "ipc-stop") {
    child.send({ neocord: "other" });
    child.send({ neocord: "shutdown", extra: 1 });
    child.send({ __neocordShutdown: true });
    child.send("shutdown");
    child.send({ _eval: "1" });
    await sleep(500);
    const aliveAfterOtherMessages = child.exitCode === null && !messages.some((message) => message.disposed);
    child.send({ neocord: "shutdown" });
    const finished = await exit;
    reportResult({ aliveAfterOtherMessages, disposed: messages.filter((message) => message.disposed).length, stderr, ...finished });
  } else {
    const finished = await Promise.race([exit, sleep(15_000).then(() => ({ hang: true }))]);
    if (finished.hang === true) child.kill("SIGKILL");
    reportResult({ ...finished, stderr, during: messages.find((message) => message.started)?.during });
  }
  process.exit(0);
}

if (scenario === "signals") {
  const { Client } = await import("discord.js");
  const { startBotWith } = await import(new URL(entry.endsWith(".ts") ? "./bot.ts" : "./bot.js", entry).href);
  let disposed = 0;
  const context = {
    __neocord: "context",
    factory: () => ({
      value: {},
      dispose: () => {
        disposed += 1;
      },
    }),
  };
  await startBotWith(
    { config: { token: DUMMY, logLevel: "silent" }, manifest: { ...manifest, context: { default: context } } },
    {
      createClient: (options) => {
        const client = new Client(options);
        client.login = async () => DUMMY;
        return client;
      },
    },
  );
  let survivedRejection = false;
  Promise.reject(new Error("orphan rejection"));
  await new Promise((resolve) => setTimeout(resolve, 20));
  survivedRejection = true;
  process.on("exit", (code) => {
    process.stdout.write(`RESULT ${JSON.stringify({ scenario, survivedRejection, disposed, code })}\n`);
  });
  process.emit("SIGINT");
  process.emit("SIGTERM");
  process.emit("SIGINT");
  await new Promise((resolve) => setTimeout(resolve, 5000));
  process.exit(9);
}

if (configs[scenario] !== undefined) {
  const started = Date.now();
  const guard = setTimeout(() => {
    process.stdout.write(`RESULT ${JSON.stringify({ scenario, hang: true })}\n`);
    process.exit(70);
  }, 90_000);
  guard.unref();

  try {
    await startBot({ config: configs[scenario], manifest });
    process.stdout.write(`RESULT ${JSON.stringify({ scenario, unexpected: "logged in" })}\n`);
    process.exit(1);
  } catch (error) {
    process.stdout.write(
      `RESULT ${JSON.stringify({
        scenario,
        name: error.name,
        error: error.message,
        stack: error.stack,
        elapsedMs: Date.now() - started,
      })}\n`,
    );
    process.exit(0);
  }
}

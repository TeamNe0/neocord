import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

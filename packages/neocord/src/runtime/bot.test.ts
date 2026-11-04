import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Client, GatewayIntentBits, Partials, type ClientOptions } from "discord.js";
import type { NeocordConfig } from "../config.ts";
import {
  defineCommand,
  defineContext,
  defineEvent,
  defineFeature,
  defineTask,
} from "../index.ts";
import type { Manifest, ManifestRoute } from "../types.ts";
import { describeLoginError, NeocordStartupError, startBotWith } from "./bot.ts";

function route(kind: ManifestRoute["kind"], id: string, value: unknown, feature = "core"): ManifestRoute {
  return {
    kind,
    id,
    feature,
    file: `f/${kind}/${id}.ts`,
    segments: kind === "command" ? id.split(" ") : id.split("/").slice(-1),
    module: { default: value },
    middleware: [],
    layouts: [],
    error: null,
    loading: null,
  };
}

function manifestOf(partial: Partial<Manifest> = {}): Manifest {
  return { version: 1, context: null, features: [], groups: [], routes: [], ...partial };
}

interface Started {
  options: ClientOptions | null;
  client: Client | null;
}

function fakeLogin(
  started: Started,
  behaviour: (client: Client) => Promise<string> = async (client) => {
    queueMicrotask(() => {
      (client as Client<true>).emit("clientReady", client as Client<true>);
    });
    return "token";
  },
) {
  return {
    installProcessHandlers: false,
    createClient: (options: ClientOptions) => {
      const client = new Client({ ...options, intents: options.intents });
      started.options = options;
      started.client = client;
      client.login = () => behaviour(client);
      return client;
    },
  };
}

const config: NeocordConfig = { token: "dummy-token", logLevel: "silent", intents: ["Guilds"] };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("startBot", () => {
  const originalToken = process.env.DISCORD_TOKEN;
  const originalLevel = process.env.NEOCORD_LOG_LEVEL;

  beforeEach(() => {
    delete process.env.DISCORD_TOKEN;
    process.env.NEOCORD_LOG_LEVEL = "silent";
  });

  afterEach(() => {
    if (originalToken === undefined) delete process.env.DISCORD_TOKEN;
    else process.env.DISCORD_TOKEN = originalToken;
    if (originalLevel === undefined) delete process.env.NEOCORD_LOG_LEVEL;
    else process.env.NEOCORD_LOG_LEVEL = originalLevel;
  });

  test("merges intents and partials of enabled features, with safe mentions by default", async () => {
    const started: Started = { options: null, client: null };
    const bot = await startBotWith(
      {
        config: { ...config, partials: ["Message"] },
        manifest: manifestOf({
          features: [
            { name: "on", module: { default: defineFeature({ intents: ["GuildMembers"], partials: ["Reaction"] }) } },
            { name: "off", module: { default: defineFeature({ enabled: false, intents: ["GuildPresences"] }) } },
          ],
        }),
      },
      fakeLogin(started),
    );
    expect(started.options?.intents).toEqual([GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]);
    expect(started.options?.partials).toEqual([Partials.Message, Partials.Reaction]);
    expect(started.options?.allowedMentions).toEqual({ parse: [] });
    await bot.stop();
  });

  test("users can override allowedMentions through client options", async () => {
    const started: Started = { options: null, client: null };
    const bot = await startBotWith(
      { config: { ...config, client: { allowedMentions: { parse: ["users"] } } }, manifest: manifestOf() },
      fakeLogin(started),
    );
    expect(started.options?.allowedMentions).toEqual({ parse: ["users"] });
    await bot.stop();
  });

  test("rejects invalid modules, naming the file", async () => {
    const started: Started = { options: null, client: null };
    const failure = startBotWith(
      { config, manifest: manifestOf({ routes: [route("command", "ban", { description: "unbranded" })] }) },
      fakeLogin(started),
    );
    await expect(failure).rejects.toBeInstanceOf(NeocordStartupError);
    await expect(failure).rejects.toThrow("f/command/ban.ts must default export defineCommand");
    expect(started.client).toBeNull();
  });

  test("a missing token has an actionable error", async () => {
    const failure = startBotWith({ config: { logLevel: "silent" }, manifest: manifestOf() }, fakeLogin({ options: null, client: null }));
    await expect(failure).rejects.toThrow("No Discord bot token found");
  });

  test("unknown intents and partials are reported", async () => {
    await expect(
      startBotWith(
        { config: { ...config, intents: ["Nope" as never] }, manifest: manifestOf() },
        fakeLogin({ options: null, client: null }),
      ),
    ).rejects.toThrow('Unknown intent "Nope"');
    await expect(
      startBotWith(
        { config: { ...config, partials: ["Nope" as never] }, manifest: manifestOf() },
        fakeLogin({ options: null, client: null }),
      ),
    ).rejects.toThrow('Unknown partial "Nope"');
  });

  test("an invalid token is translated", async () => {
    const started: Started = { options: null, client: null };
    const failure = startBotWith(
      { config, manifest: manifestOf() },
      fakeLogin(started, async () => {
        throw Object.assign(new Error("An invalid token was provided."), { code: "TokenInvalid" });
      }),
    );
    await expect(failure).rejects.toThrow("Discord rejected the bot token");
    await expect(failure).rejects.toThrow("https://discord.com/developers/applications");
    await failure.catch((error: Error) => {
      expect(error.stack).toBe(`NeocordStartupError: ${error.message}`);
    });
  });

  test("disallowed intents from login are translated with the privileged list", async () => {
    const failure = startBotWith(
      { config: { ...config, intents: ["Guilds", "MessageContent", "GuildMembers"] }, manifest: manifestOf() },
      fakeLogin({ options: null, client: null }, async () => {
        throw new Error("Used disallowed intents");
      }),
    );
    await expect(failure).rejects.toThrow("close code 4014");
    await expect(failure).rejects.toThrow("MessageContent, GuildMembers");
    await expect(failure).rejects.toThrow("Privileged Gateway Intents");
  });

  test("close code 4014 without a login rejection still fails instead of hanging", async () => {
    const failure = startBotWith(
      { config, manifest: manifestOf() },
      fakeLogin({ options: null, client: null }, (client) => {
        queueMicrotask(() => {
          client.emit("shardDisconnect", { code: 4014, reason: "", wasClean: true } as never, 0);
        });
        return new Promise(() => undefined);
      }),
    );
    await expect(failure).rejects.toThrow("close code 4014");
  });

  test("close code 4004 is an invalid token", async () => {
    const failure = startBotWith(
      { config, manifest: manifestOf() },
      fakeLogin({ options: null, client: null }, (client) => {
        queueMicrotask(() => {
          client.emit("shardDisconnect", { code: 4004, reason: "", wasClean: true } as never, 0);
        });
        return new Promise(() => undefined);
      }),
    );
    await expect(failure).rejects.toThrow("Discord rejected the bot token");
  });

  test("network failures have an actionable error", async () => {
    const failure = startBotWith(
      { config, manifest: manifestOf() },
      fakeLogin({ options: null, client: null }, async () => {
        throw Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } });
      }),
    );
    await expect(failure).rejects.toThrow("Could not reach Discord");
  });

  test("describeLoginError recognises other cases and passes startup errors through", () => {
    const original = new NeocordStartupError("already");
    expect(describeLoginError(original, [])).toBe(original);
    expect(describeLoginError(new Error("Sharding is required"), []).message).toContain("close code 4011");
    expect(describeLoginError(new Error("Used invalid intents"), ["Guilds"]).message).toContain("Guilds");
    expect(describeLoginError(new Error("Authentication failed"), []).message).toContain("rejected the bot token");
    expect(describeLoginError(Object.assign(new Error("x"), { status: 401 }), []).message).toContain("rejected");
    expect(describeLoginError(new Error("strange"), []).message).toBe("Could not log in to Discord: strange");
    expect(describeLoginError("text", []).message).toBe("Could not log in to Discord: text");
  });

  test("creates the app context, exposes it and disposes it once", async () => {
    let disposed = 0;
    const started: Started = { options: null, client: null };
    let received: unknown;
    const context = defineContext(async ({ client, logger }) => {
      received = [client === started.client, typeof logger.info];
      return {
        value: { db: "pg" },
        dispose: () => {
          disposed += 1;
        },
      };
    });
    const bot = await startBotWith({ config, manifest: manifestOf({ context: { default: context } }) }, fakeLogin(started));
    expect(received).toEqual([true, "function"]);
    expect(bot.app).toEqual({ db: "pg" } as never);
    await Promise.all([bot.stop(), bot.stop()]);
    await bot.stop();
    expect(disposed).toBe(1);
  });

  test("a failing context factory is a startup error", async () => {
    const context = defineContext(() => {
      throw new Error("db down");
    });
    await expect(
      startBotWith({ config, manifest: manifestOf({ context: { default: context } }) }, fakeLogin({ options: null, client: null })),
    ).rejects.toThrow("src/context.ts failed to create the app context: db down");
  });

  test("a failed login stops everything it started", async () => {
    let disposed = 0;
    const context = defineContext(() => ({
      value: {},
      dispose: () => {
        disposed += 1;
      },
    }));
    await startBotWith(
      { config, manifest: manifestOf({ context: { default: context } }) },
      fakeLogin({ options: null, client: null }, async () => {
        throw new Error("nope");
      }),
    ).catch(() => undefined);
    expect(disposed).toBe(1);
  });

  test("registers events with on and once, and isolates their errors", async () => {
    const started: Started = { options: null, client: null };
    const calls: string[] = [];
    const manifest = manifestOf({
      routes: [
        route(
          "event",
          "guildCreate",
          defineEvent("guildCreate", {
            execute: () => {
              calls.push("on");
              throw new Error("boom");
            },
          }),
        ),
        route(
          "event",
          "guildDelete",
          defineEvent("guildDelete", {
            once: true,
            execute: () => {
              calls.push("once");
            },
          }),
        ),
        route(
          "event",
          "roleCreate",
          defineEvent("roleCreate", {
            execute: () => {
              calls.push("disabled");
            },
          }),
          "off",
        ),
      ],
      features: [{ name: "off", module: { default: defineFeature({ enabled: false }) } }],
    });
    const bot = await startBotWith({ config, manifest }, fakeLogin(started));
    const client = started.client as Client;
    client.emit("guildCreate", {} as never);
    client.emit("guildCreate", {} as never);
    client.emit("guildDelete", {} as never);
    client.emit("guildDelete", {} as never);
    client.emit("roleCreate", {} as never);
    await sleep(5);
    expect(calls).toEqual(["on", "on", "once"]);
    await bot.stop();
  });

  test("tasks start on clientReady and stop with the bot", async () => {
    const started: Started = { options: null, client: null };
    let runs = 0;
    const manifest = manifestOf({
      routes: [
        route(
          "task",
          "core/job",
          defineTask({
            every: 5,
            execute: () => {
              runs += 1;
            },
          }),
        ),
      ],
    });
    const bot = await startBotWith({ config, manifest }, fakeLogin(started));
    await sleep(30);
    expect(runs).toBeGreaterThan(1);
    await bot.stop();
    const count = runs;
    await sleep(15);
    expect(runs).toBe(count);
  });

  test("tasks do not start before clientReady", async () => {
    let runs = 0;
    const manifest = manifestOf({
      routes: [
        route(
          "task",
          "core/job",
          defineTask({
            every: 2,
            runOnStart: true,
            execute: () => {
              runs += 1;
            },
          }),
        ),
      ],
    });
    const bot = await startBotWith(
      { config, manifest },
      fakeLogin({ options: null, client: null }, async () => "token"),
    );
    await sleep(10);
    expect(runs).toBe(0);
    await bot.stop();
  });

  test("interactions reach the dispatcher and stop destroys the client", async () => {
    const started: Started = { options: null, client: null };
    const replies: unknown[] = [];
    const definition = defineCommand({ description: "d", execute: () => "hello" });
    const bot = await startBotWith(
      { config, manifest: manifestOf({ routes: [route("command", "hi", definition)] }) },
      fakeLogin(started),
    );
    const { createFakeInteraction } = await import("../testing/fakes.ts");
    const interaction = createFakeInteraction({
      kind: "command",
      commandName: "hi",
      hook: (method, payload) => {
        if (method === "reply") replies.push(payload);
      },
    });
    started.client?.emit("interactionCreate", interaction);
    for (let waited = 0; replies.length === 0 && waited < 2000; waited += 10) await sleep(10);
    expect(replies).toHaveLength(1);

    let destroyed = false;
    const client = started.client as Client;
    const destroy = client.destroy.bind(client);
    client.destroy = async () => {
      destroyed = true;
      await destroy();
    };
    await bot.stop();
    expect(destroyed).toBe(true);
  });
});

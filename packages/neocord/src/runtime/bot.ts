import {
  Client,
  GatewayCloseCodes,
  GatewayIntentBits,
  Partials,
  type ClientOptions,
  type Interaction,
} from "discord.js";
import { parentPort } from "node:worker_threads";
import type { IntentName, NeocordConfig, PartialName } from "../config.ts";
import { parseDuration } from "../duration.ts";
import { createLogger, currentShardLabel, resolveLogLevel, type Logger } from "../logger.ts";
import type { AppContext, Bot, Manifest } from "../types.ts";
import { createBaseContext, createDispatcher, createEventHandler, type Dispatcher } from "./dispatch.tsx";
import { MISSING_TOKEN_MESSAGE, resolveToken } from "./deploy.ts";
import { compileManifest, contextDefinition, listCommands, mergedIntents, mergedPartials } from "./manifest.ts";
import { createShardHelpers } from "./shards.ts";
import { createTaskRunner, type TaskRunner } from "./tasks.ts";
import { validateManifest } from "./validate.ts";

export interface StartBotOptions {
  config: NeocordConfig;
  manifest: Manifest;
}

export interface StartBotDependencies {
  createClient?: (options: ClientOptions) => Client;
  installProcessHandlers?: boolean;
}

export class NeocordStartupError extends Error {
  override readonly name = "NeocordStartupError";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.stack = `${this.name}: ${message}`;
  }
}

export const SHUTDOWN_MESSAGE = "__neocordShutdown";
export const FATAL_MESSAGE = "__neocordFatal";

const DEFAULT_LIVE_TTL = "14m";
const DEFAULT_AUTO_DEFER_MS = 2000;
const LOGIN_TIMEOUT_MS = 120_000;
const PORTAL_URL = "https://discord.com/developers/applications";
const PRIVILEGED_INTENTS: readonly IntentName[] = ["GuildMembers", "GuildPresences", "MessageContent"];

function resolveIntents(names: readonly IntentName[]): GatewayIntentBits[] {
  return names.map((name) => {
    const bit = GatewayIntentBits[name];
    if (typeof bit !== "number") {
      throw new NeocordStartupError(`Unknown intent "${name}" in neocord.config.ts. Use a key of GatewayIntentBits, such as "Guilds".`);
    }
    return bit;
  });
}

function resolvePartials(names: readonly PartialName[]): Partials[] {
  return names.map((name) => {
    const partial = Partials[name];
    if (typeof partial !== "number") {
      throw new NeocordStartupError(`Unknown partial "${name}" in neocord.config.ts. Use a key of Partials, such as "Message".`);
    }
    return partial;
  });
}

function disallowedIntentsMessage(intents: readonly IntentName[]): string {
  const privileged = intents.filter((intent) => PRIVILEGED_INTENTS.includes(intent));
  const list = privileged.length > 0 ? privileged.join(", ") : "none detected";
  return `Discord refused the requested gateway intents (close code 4014). Privileged intents requested: ${list}. Enable them at ${PORTAL_URL}, under your application's Bot > Privileged Gateway Intents, or remove them from your config.`;
}

const INVALID_TOKEN_MESSAGE = `Discord rejected the bot token. Reset it at ${PORTAL_URL} under Bot > Reset Token, then update DISCORD_TOKEN or the token in neocord.config.ts.`;

function closeCodeMessage(code: number, intents: readonly IntentName[]): string | null {
  switch (code) {
    case GatewayCloseCodes.DisallowedIntents:
      return disallowedIntentsMessage(intents);
    case GatewayCloseCodes.AuthenticationFailed:
      return INVALID_TOKEN_MESSAGE;
    case GatewayCloseCodes.InvalidIntents:
      return `Discord reported invalid intents (close code 4013). Check the intents in neocord.config.ts: ${intents.join(", ")}.`;
    case GatewayCloseCodes.ShardingRequired:
      return "Discord requires this bot to shard (close code 4011). Run it with `neocord start` so the sharding manager is used.";
    case GatewayCloseCodes.InvalidShard:
      return "Discord reported an invalid shard configuration (close code 4010). Check sharding.totalShards and sharding.shardList.";
    case GatewayCloseCodes.InvalidAPIVersion:
      return "Discord rejected the gateway API version (close code 4012). Update discord.js.";
    default:
      return null;
  }
}

const NETWORK_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENETUNREACH",
  "EHOSTUNREACH",
  "ConnectionRefused",
  "FailedToOpenSocket",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);

function isNetworkError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && typeof current === "object" && current !== null; depth++) {
    const { code, name, message, cause } = current as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
    if (typeof code === "string" && NETWORK_CODES.has(code)) return true;
    if (name === "AbortError" || name === "TimeoutError") return true;
    if (typeof message === "string" && /fetch failed|unable to connect|socket connection was closed|getaddrinfo/i.test(message)) {
      return true;
    }
    current = cause;
  }
  return false;
}

export function describeLoginError(error: unknown, intents: readonly IntentName[]): NeocordStartupError {
  if (error instanceof NeocordStartupError) return error;
  const { code, message, status } = (error ?? {}) as { code?: unknown; message?: unknown; status?: unknown };
  if (code === "TokenInvalid" || status === 401) {
    return new NeocordStartupError(INVALID_TOKEN_MESSAGE, { cause: error });
  }
  if (typeof message === "string") {
    if (/disallowed intents/i.test(message)) {
      return new NeocordStartupError(disallowedIntentsMessage(intents), { cause: error });
    }
    if (/invalid intents/i.test(message)) {
      return new NeocordStartupError(closeCodeMessage(GatewayCloseCodes.InvalidIntents, intents) ?? message, { cause: error });
    }
    if (/authentication failed/i.test(message)) {
      return new NeocordStartupError(INVALID_TOKEN_MESSAGE, { cause: error });
    }
    if (/sharding is required/i.test(message)) {
      return new NeocordStartupError(closeCodeMessage(GatewayCloseCodes.ShardingRequired, intents) ?? message, { cause: error });
    }
  }
  if (isNetworkError(error)) {
    return new NeocordStartupError(
      `Could not reach Discord: ${typeof message === "string" ? message : "network error"}. Check your internet connection and https://discordstatus.com, then try again.`,
      { cause: error },
    );
  }
  return new NeocordStartupError(
    `Could not log in to Discord: ${typeof message === "string" ? message : String(error)}`,
    { cause: error },
  );
}

async function notifyManagerOfFatal(message: string): Promise<void> {
  if (parentPort !== null) {
    parentPort.postMessage({ [FATAL_MESSAGE]: message });
    return;
  }
  if (typeof process.send === "function" && process.env.SHARDING_MANAGER) {
    await new Promise<void>((resolve) => {
      process.send?.({ [FATAL_MESSAGE]: message }, undefined, undefined, () => resolve());
    });
  }
}

interface Disposer {
  (): void;
}

function installProcessHandlers(logger: Logger, stop: () => Promise<void>): Disposer {
  const handleSignal = (signal: NodeJS.Signals): void => {
    logger.info(`Received ${signal}, shutting down.`);
    void stop().finally(() => process.exit(0));
  };
  const onSigint = (): void => handleSignal("SIGINT");
  const onSigterm = (): void => handleSignal("SIGTERM");
  const onRejection = (reason: unknown): void => {
    logger.error("Unhandled promise rejection.", reason);
  };
  const onMessage = (message: unknown): void => {
    if (typeof message === "object" && message !== null && SHUTDOWN_MESSAGE in message) {
      logger.info("The sharding manager requested a shutdown.");
      void stop().finally(() => process.exit(0));
    }
  };

  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  process.on("unhandledRejection", onRejection);
  const port = parentPort;
  if (port !== null) {
    port.on("message", onMessage);
  } else if (process.env.SHARDING_MANAGER) {
    process.on("message", onMessage);
  }

  return () => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    process.off("unhandledRejection", onRejection);
    if (port !== null) {
      port.off("message", onMessage);
    } else {
      process.off("message", onMessage);
    }
  };
}

export async function startBotWith(options: StartBotOptions, dependencies: StartBotDependencies = {}): Promise<Bot> {
  const { config, manifest } = options;
  const token = resolveToken(config);
  const logger = createLogger({
    level: resolveLogLevel(config.logLevel),
    shard: currentShardLabel(),
    secrets: [token],
  });

  const fail = async (error: NeocordStartupError): Promise<never> => {
    logger.error(error.message);
    await notifyManagerOfFatal(error.message);
    throw error;
  };

  const issues = validateManifest(manifest, config);
  for (const issue of issues) {
    if (issue.severity === "warning") logger.warn(`${issue.file}: ${issue.message}`);
  }
  const errors = issues.filter((issue) => issue.severity === "error");
  if (errors.length > 0) {
    return fail(
      new NeocordStartupError(
        `The manifest has errors:\n${errors.map((issue) => `  ${issue.file}: ${issue.message}`).join("\n")}`,
      ),
    );
  }

  if (token === undefined) return fail(new NeocordStartupError(MISSING_TOKEN_MESSAGE));

  const intentNames = mergedIntents(manifest, config.intents);
  let client: Client<true>;
  try {
    const clientOptions: ClientOptions = {
      allowedMentions: { parse: [] },
      ...config.client,
      intents: resolveIntents(intentNames),
      partials: resolvePartials(mergedPartials(manifest, config.partials)),
    };
    client = (dependencies.createClient?.(clientOptions) ?? new Client(clientOptions)) as Client<true>;
  } catch (error) {
    return fail(error instanceof NeocordStartupError ? error : new NeocordStartupError(`Could not create the Discord client: ${(error as Error).message}`, { cause: error }));
  }

  client.on("error", (error) => logger.error("Discord client error.", error));
  client.on("warn", (message) => logger.warn(message));
  if (logger.level === "debug") client.on("debug", (message) => logger.debug(message));
  client.on("shardError", (error, shardId) => logger.error(`Gateway error on shard ${shardId}.`, error));
  client.on("shardReconnecting", (shardId) => logger.debug(`Shard ${shardId} is reconnecting.`));

  let app: AppContext = {} as AppContext;
  let dispose: (() => unknown) | undefined;
  const shards = createShardHelpers(client);
  const compiled = compileManifest(manifest);

  const context = contextDefinition(manifest.context);
  if (context !== null) {
    try {
      const created = await context.factory({ client, logger: logger.child("context") });
      app = created.value as AppContext;
      dispose = created.dispose;
    } catch (error) {
      void client.destroy();
      return fail(
        new NeocordStartupError(`src/context.ts failed to create the app context: ${(error as Error).message}`, { cause: error }),
      );
    }
  }

  let dispatcher: Dispatcher;
  try {
    dispatcher = createDispatcher({
      client,
      app,
      logger,
      shards,
      compiled,
      autoDeferAfter: config.autoDefer === false ? false : (config.autoDefer?.after ?? DEFAULT_AUTO_DEFER_MS),
      liveTtl: parseDuration(config.live?.ttl ?? DEFAULT_LIVE_TTL),
    });
  } catch (error) {
    return fail(new NeocordStartupError((error as Error).message, { cause: error }));
  }

  const onInteraction = (interaction: Interaction): void => {
    void dispatcher.handle(interaction);
  };
  client.on("interactionCreate", onInteraction);

  const runtimeOptions = { client, app, logger, shards, commands: listCommands(compiled) };
  for (const route of compiled.events) {
    const listener = createEventHandler(route, runtimeOptions) as (...args: unknown[]) => void;
    const event = route.definition.event as string;
    if (route.definition.once === true) {
      client.once(event, listener);
    } else {
      client.on(event, listener);
    }
  }

  const tasks: TaskRunner = createTaskRunner({
    tasks: compiled.tasks,
    client,
    logger,
    createContext: (route) => createBaseContext(runtimeOptions, route),
  });
  client.once("clientReady", () => {
    logger.info(`Logged in as ${client.user?.tag ?? "unknown"}.`);
    tasks.start();
  });

  let stopping: Promise<void> | null = null;
  let removeHandlers: Disposer = () => undefined;
  const stop = (): Promise<void> => {
    stopping ??= (async () => {
      removeHandlers();
      await tasks.stop();
      await dispatcher.shutdown();
      try {
        await dispose?.();
      } catch (error) {
        logger.error("Disposing the app context failed.", error);
      }
      try {
        await client.destroy();
      } catch (error) {
        logger.error("Destroying the Discord client failed.", error);
      }
      logger.info("Stopped.");
    })();
    return stopping;
  };

  if (dependencies.installProcessHandlers !== false) removeHandlers = installProcessHandlers(logger, stop);

  const failedClose = new Promise<never>((_resolve, reject) => {
    client.on("shardDisconnect", (event, shardId) => {
      const message = closeCodeMessage(event.code, intentNames);
      if (message !== null) {
        reject(new NeocordStartupError(message));
      } else {
        logger.warn(`Shard ${shardId} disconnected with close code ${event.code}.`);
      }
    });
  });
  failedClose.catch(() => undefined);

  let loginTimer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_resolve, reject) => {
    loginTimer = setTimeout(() => {
      reject(
        new NeocordStartupError(
          `Timed out after ${LOGIN_TIMEOUT_MS / 1000}s connecting to the Discord gateway. Check your connection and https://discordstatus.com.`,
        ),
      );
    }, LOGIN_TIMEOUT_MS);
    loginTimer.unref();
  });
  timedOut.catch(() => undefined);

  try {
    await Promise.race([client.login(token), failedClose, timedOut]);
  } catch (error) {
    const described = describeLoginError(error, intentNames);
    logger.error(described.message);
    await notifyManagerOfFatal(described.message);
    await stop().catch(() => undefined);
    throw described;
  } finally {
    if (loginTimer !== undefined) clearTimeout(loginTimer);
  }

  return { client, app, manifest, logger, stop };
}

export function startBot(options: StartBotOptions): Promise<Bot> {
  return startBotWith(options);
}

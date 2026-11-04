import { ShardingManager, type Shard } from "discord.js";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import type { NeocordConfig } from "../config.ts";
import { createLogger, resolveLogLevel, type Logger } from "../logger.ts";
import { FATAL_MESSAGE, NeocordStartupError, SHUTDOWN_MESSAGE } from "./bot.ts";
import { MISSING_TOKEN_MESSAGE, resolveToken } from "./deploy.ts";

export interface StartManagerOptions {
  config: NeocordConfig;
  shardFile: string | URL;
  shards?: number | undefined;
}

const SHARD_STOP_WAIT_MS = 5000;

function toPath(file: string | URL): string {
  if (file instanceof URL) return fileURLToPath(file);
  return file.startsWith("file:") ? fileURLToPath(file) : resolvePath(file);
}

export function resolveTotalShards(
  explicit: number | undefined,
  env: string | undefined,
  configured: number | "auto" | undefined,
): number | "auto" {
  if (explicit !== undefined) return explicit;
  if (env !== undefined && env.trim() !== "") {
    const parsed = Number(env);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new NeocordStartupError(`NEOCORD_SHARD_COUNT must be a positive integer, received "${env}".`);
    }
    return parsed;
  }
  return configured ?? "auto";
}

function describeSpawnError(error: unknown, timeout: number, token: string): NeocordStartupError {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  const detail = typeof message === "string" ? message.replaceAll(token, "[redacted]") : String(error);
  switch (code) {
    case "ShardingReadyTimeout":
      return new NeocordStartupError(
        `${detail} A shard must connect within sharding.spawnTimeout (${timeout}ms). Check the shard logs above for login errors, or increase the timeout for slow networks.`,
        { cause: error },
      );
    case "ShardingReadyDied":
      return new NeocordStartupError(
        `${detail} The shard process crashed during startup. Check the shard logs above for the reason.`,
        { cause: error },
      );
    case "ShardingReadyDisconnected":
      return new NeocordStartupError(
        `${detail} The shard lost its gateway connection during startup. Check your token, intents and network.`,
        { cause: error },
      );
    case "TokenInvalid":
      return new NeocordStartupError(
        "Discord rejected the bot token while fetching the recommended shard count. Reset it at https://discord.com/developers/applications under Bot > Reset Token.",
        { cause: error },
      );
    default:
      return new NeocordStartupError(`Could not spawn shards: ${detail}`, { cause: error });
  }
}

function attachShardLogging(shard: Shard, logger: Logger, onFatal: (message: string) => void): void {
  const log = logger.child(`shard ${shard.id}`);
  log.info("Created.");
  shard.on("spawn", () => log.debug("Spawned."));
  shard.on("ready", () => log.info("Ready."));
  shard.on("disconnect", () => log.warn("Disconnected."));
  shard.on("reconnecting", () => log.info("Reconnecting."));
  shard.on("resume", () => log.info("Resumed."));
  shard.on("death", (child) => {
    const code = typeof child === "object" && child !== null && "exitCode" in child ? child.exitCode : null;
    log.warn(`Exited${code === null || code === undefined ? "" : ` with code ${code}`}.`);
  });
  shard.on("error", (error) => log.error("Shard error.", error));
  shard.on("message", (message: unknown) => {
    if (typeof message === "object" && message !== null && FATAL_MESSAGE in message) {
      onFatal(String((message as Record<string, unknown>)[FATAL_MESSAGE]));
    }
  });
}

async function stopShards(manager: ShardingManager, logger: Logger): Promise<void> {
  manager.respawn = false;
  const shards = [...manager.shards.values()];
  await Promise.allSettled(
    shards.map(async (shard) => {
      if (shard.process === null && shard.worker === null) return;
      const exited = new Promise<void>((resolve) => {
        shard.once("death", () => resolve());
      });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, SHARD_STOP_WAIT_MS);
        timer.unref();
      });
      await shard.send({ [SHUTDOWN_MESSAGE]: true }).catch((error: unknown) => {
        logger.debug(`Could not ask shard ${shard.id} to stop.`, error);
      });
      await Promise.race([exited, timeout]);
      if (timer !== undefined) clearTimeout(timer);
      if (shard.process !== null || shard.worker !== null) {
        try {
          shard.kill();
        } catch (error) {
          logger.debug(`Could not kill shard ${shard.id}.`, error);
        }
      }
    }),
  );
}

export async function startManager(options: StartManagerOptions): Promise<ShardingManager> {
  const { config } = options;
  const token = resolveToken(config);
  const logger = createLogger({
    level: resolveLogLevel(config.logLevel),
    scope: "manager",
    secrets: [token],
  });

  const fail = (error: NeocordStartupError): never => {
    logger.error(error.message);
    throw error;
  };

  if (token === undefined) return fail(new NeocordStartupError(MISSING_TOKEN_MESSAGE));

  const sharding = config.sharding ?? {};
  const totalShards = resolveTotalShards(options.shards, process.env.NEOCORD_SHARD_COUNT, sharding.totalShards);
  const spawnDelay = sharding.spawnDelay ?? 5500;
  const spawnTimeout = sharding.spawnTimeout ?? 30_000;
  const mode = sharding.mode ?? "process";

  let manager: ShardingManager;
  try {
    manager = new ShardingManager(toPath(options.shardFile), {
      token,
      totalShards,
      shardList: sharding.shardList ?? "auto",
      mode,
      respawn: sharding.respawn ?? true,
    });
  } catch (error) {
    return fail(new NeocordStartupError(`Could not create the sharding manager: ${(error as Error).message}`, { cause: error }));
  }

  let fatal: string | null = null;
  manager.on("shardCreate", (shard) => {
    attachShardLogging(shard, logger, (message) => {
      fatal ??= message;
      manager.respawn = false;
    });
  });

  let stopping = false;
  const onSignal = (signal: NodeJS.Signals): void => {
    if (stopping) return;
    stopping = true;
    logger.info(`Received ${signal}, stopping shards.`);
    void stopShards(manager, logger).finally(() => process.exit(0));
  };
  const onSigint = (): void => onSignal("SIGINT");
  const onSigterm = (): void => onSignal("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  try {
    await manager.spawn({ delay: spawnDelay, timeout: spawnTimeout });
  } catch (error) {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    await stopShards(manager, logger);
    return fail(
      fatal !== null ? new NeocordStartupError(fatal, { cause: error }) : describeSpawnError(error, spawnTimeout, token),
    );
  }

  logger.info(`All ${manager.shards.size} shards are ready (${mode} mode).`);
  return manager;
}

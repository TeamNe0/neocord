import { ShardingManager, type Shard } from "discord.js";
import { resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import type { NeocordConfig } from "../config.ts";
import { createLogger, resolveLogLevel, type Logger } from "../logger.ts";
import {
  exitCleanlyIfUncaught,
  FATAL_MESSAGE,
  isShutdownRequest,
  NeocordStartupError,
  SHUTDOWN_MESSAGE,
  STARTUP_FAILURE_MESSAGE,
} from "./bot.ts";
import { MISSING_TOKEN_MESSAGE, resolveToken } from "./deploy.ts";
import { MANAGER_SHARD_STOP_WAIT_MS } from "./shutdown-budget.ts";

export interface StartManagerOptions {
  config: NeocordConfig;
  shardFile: string | URL;
  shards?: number | undefined;
}

export const RESPAWN_BASE_DELAY_MS = 1000;
export const RESPAWN_MAX_DELAY_MS = 60_000;
export const HEALTHY_UPTIME_MS = 60_000;

export function respawnDelay(attempt: number): number {
  return Math.min(RESPAWN_BASE_DELAY_MS * 2 ** Math.max(attempt - 1, 0), RESPAWN_MAX_DELAY_MS);
}

export function nextRespawnAttempt(attempts: number, readyAt: number | null, now: number): number {
  const healthy = readyAt !== null && now - readyAt >= HEALTHY_UPTIME_MS;
  return healthy ? 1 : attempts + 1;
}

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

function shardMessageText(message: unknown, key: string): string | null {
  return typeof message === "object" && message !== null && key in message ? String((message as Record<string, unknown>)[key]) : null;
}

function isRunning(shard: Shard): boolean {
  return shard.process !== null || shard.worker !== null;
}

async function stopShard(shard: Shard, kill: () => void, logger: Logger): Promise<void> {
  if (!isRunning(shard)) return;
  const exited = new Promise<void>((resolve) => {
    shard.once("death", () => resolve());
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, MANAGER_SHARD_STOP_WAIT_MS);
    timer.unref();
  });
  await shard.send({ [SHUTDOWN_MESSAGE]: true }).catch((error: unknown) => {
    logger.debug(`Could not ask shard ${shard.id} to stop.`, error);
  });
  await Promise.race([exited, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  if (isRunning(shard)) {
    try {
      kill();
    } catch (error) {
      logger.debug(`Could not kill shard ${shard.id}.`, error);
    }
  }
}

interface ShardState {
  shard: Shard;
  log: Logger;
  kill: () => void;
  attempts: number;
  readyAt: number | null;
  everReady: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  retired: boolean;
  released: boolean;
}

interface SupervisorOptions {
  logger: Logger;
  respawn: boolean;
  spawnDelay: number;
  spawnTimeout: number;
  onNoShardsLeft(): void;
}

interface Supervisor {
  readonly startupMessage: string | null;
  readonly startupFatal: boolean;
  adopt(shard: Shard): void;
  finishInitialSpawn(): void;
  stop(): void;
  stopAll(): Promise<void>;
}

function createSupervisor(options: SupervisorOptions): Supervisor {
  const { logger, respawn, spawnDelay, spawnTimeout } = options;
  const states = new Map<number, ShardState>();
  let initialSpawn = true;
  let stopping = false;
  let startupMessage: string | null = null;
  let startupFatal = false;
  let nextSpawnAt = 0;

  const clearRespawn = (state: ShardState): void => {
    if (state.timer !== null) {
      clearTimeout(state.timer);
      state.timer = null;
    }
  };

  const checkShardsLeft = (): void => {
    if (stopping || initialSpawn || states.size === 0) return;
    if ([...states.values()].every((state) => state.retired)) options.onNoShardsLeft();
  };

  const attemptRespawn = (state: ShardState): void => {
    state.timer = null;
    const { shard, log } = state;
    if (stopping || state.retired || isRunning(shard)) return;
    log.info(`Respawning, attempt ${state.attempts}.`);
    shard.spawn(spawnTimeout).catch((error: unknown) => {
      const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
      if (stopping || code === "ShardingReadyDied") return;
      log.warn(`Respawn attempt ${state.attempts} failed: ${typeof message === "string" ? message : String(error)}`);
      void stopShard(shard, state.kill, log);
    });
  };

  const scheduleRespawn = (state: ShardState): void => {
    const now = Date.now();
    state.attempts = nextRespawnAttempt(state.attempts, state.readyAt, now);
    state.readyAt = null;
    const delay = Math.max(respawnDelay(state.attempts), nextSpawnAt - now);
    nextSpawnAt = now + delay + spawnDelay;
    state.log.warn(`Respawn attempt ${state.attempts} in ${delay}ms.`);
    state.timer = setTimeout(() => attemptRespawn(state), delay);
  };

  const handleDeath = (state: ShardState): void => {
    if (stopping || state.released) return;
    if (initialSpawn && !state.everReady) return;
    if (!respawn) state.retired = true;
    if (state.retired) {
      checkShardsLeft();
      return;
    }
    scheduleRespawn(state);
  };

  const handleMessage = (state: ShardState, message: unknown): void => {
    const fatal = shardMessageText(message, FATAL_MESSAGE);
    if (fatal !== null) {
      state.retired = true;
      clearRespawn(state);
      if (initialSpawn) {
        startupMessage = fatal;
        startupFatal = true;
        return;
      }
      state.log.error(`Stopped for good: ${fatal}`);
      if (!isRunning(state.shard)) checkShardsLeft();
      return;
    }
    const failure = shardMessageText(message, STARTUP_FAILURE_MESSAGE);
    if (failure === null) return;
    if (initialSpawn) {
      startupMessage ??= failure;
    } else {
      state.log.warn(failure);
    }
  };

  return {
    get startupMessage() {
      return startupMessage;
    },
    get startupFatal() {
      return startupFatal;
    },

    adopt(shard) {
      const log = logger.child(`shard ${shard.id}`);
      const kill = shard.kill.bind(shard);
      const state: ShardState = {
        shard,
        log,
        kill,
        attempts: 0,
        readyAt: null,
        everReady: false,
        timer: null,
        retired: false,
        released: false,
      };
      states.set(shard.id, state);
      shard.kill = () => {
        state.released = true;
        clearRespawn(state);
        kill();
      };

      log.info("Created.");
      shard.on("spawn", (child) => {
        state.released = false;
        log.debug("Spawned.");
        if (child instanceof Worker) {
          child.on("error", (error) => log.error("Uncaught error in the shard worker.", error));
        }
      });
      shard.on("ready", () => {
        state.readyAt = Date.now();
        state.everReady = true;
        log.info("Ready.");
      });
      shard.on("disconnect", () => log.warn("Disconnected."));
      shard.on("reconnecting", () => log.info("Reconnecting."));
      shard.on("resume", () => log.info("Resumed."));
      shard.on("death", (child) => {
        const code = typeof child === "object" && child !== null && "exitCode" in child ? child.exitCode : null;
        const text = `Exited${code === null || code === undefined ? "" : ` with code ${code}`}.`;
        if (initialSpawn && !state.everReady) {
          log.debug(text);
        } else {
          log.warn(text);
        }
        handleDeath(state);
      });
      shard.on("error", (error) => log.error("Shard error.", error));
      shard.on("message", (message: unknown) => handleMessage(state, message));
    },

    finishInitialSpawn() {
      initialSpawn = false;
      checkShardsLeft();
    },

    stop() {
      stopping = true;
      for (const state of states.values()) clearRespawn(state);
    },

    async stopAll() {
      stopping = true;
      for (const state of states.values()) clearRespawn(state);
      await Promise.allSettled([...states.values()].map((state) => stopShard(state.shard, () => state.shard.kill(), logger)));
    },
  };
}

async function startManagerWith(options: StartManagerOptions): Promise<ShardingManager> {
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
  let totalShards: number | "auto";
  try {
    totalShards = resolveTotalShards(options.shards, process.env.NEOCORD_SHARD_COUNT, sharding.totalShards);
  } catch (error) {
    if (error instanceof NeocordStartupError) return fail(error);
    throw error;
  }
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
      respawn: false,
    });
  } catch (error) {
    return fail(new NeocordStartupError(`Could not create the sharding manager: ${(error as Error).message}`, { cause: error }));
  }

  const supervisor = createSupervisor({
    logger,
    respawn: sharding.respawn ?? true,
    spawnDelay,
    spawnTimeout,
    onNoShardsLeft: () => {
      supervisor.stop();
      logger.error("No shards are left running and none will be respawned, so the manager is exiting.");
      process.exit(1);
    },
  });
  manager.on("shardCreate", (shard) => supervisor.adopt(shard));

  let stopRequested = false;
  const requestStop = (reason: string): void => {
    if (stopRequested) return;
    stopRequested = true;
    logger.info(`${reason}, stopping shards.`);
    void supervisor.stopAll().finally(() => process.exit(0));
  };
  const onSigint = (): void => requestStop("Received SIGINT");
  const onSigterm = (): void => requestStop("Received SIGTERM");
  const onSighup = (): void => requestStop("Received SIGHUP");
  const onMessage = (message: unknown): void => {
    if (isShutdownRequest(message)) requestStop("Received a shutdown request");
  };
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);
  process.on("SIGHUP", onSighup);
  const hasChannel = typeof process.send === "function";
  if (hasChannel) {
    process.on("message", onMessage);
    process.channel?.unref();
  }
  const removeHandlers = (): void => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
    process.off("SIGHUP", onSighup);
    if (hasChannel) process.off("message", onMessage);
  };

  const abortStartup = async (error: unknown): Promise<never> => {
    await supervisor.stopAll();
    removeHandlers();
    const { startupMessage } = supervisor;
    return fail(
      startupMessage !== null
        ? new NeocordStartupError(startupMessage, { cause: error })
        : describeSpawnError(error, spawnTimeout, token),
    );
  };

  try {
    await manager.spawn({ delay: spawnDelay, timeout: spawnTimeout });
  } catch (error) {
    if (stopRequested) return manager;
    return abortStartup(error);
  }
  if (supervisor.startupFatal) return abortStartup(null);

  supervisor.finishInitialSpawn();
  logger.info(`All ${manager.shards.size} shards are ready (${mode} mode).`);
  return manager;
}

export async function startManager(options: StartManagerOptions): Promise<ShardingManager> {
  try {
    return await startManagerWith(options);
  } catch (error) {
    if (error instanceof NeocordStartupError) exitCleanlyIfUncaught(error);
    throw error;
  }
}

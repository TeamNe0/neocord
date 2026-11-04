import { parseDuration } from "../duration.ts";
import type { Logger } from "../logger.ts";
import type { BaseContext, TaskDefinition } from "../types.ts";
import type { Client } from "discord.js";
import type { CompiledRoute } from "./manifest.ts";
import { TASK_STOP_WAIT_MS } from "./shutdown-budget.ts";

export interface TaskRunnerOptions {
  tasks: readonly CompiledRoute<"task">[];
  client: Client<true>;
  logger: Logger;
  createContext(route: CompiledRoute<"task">): BaseContext;
  onError?: ((error: unknown) => void) | undefined;
}

export interface TaskRunner {
  start(): void;
  stop(): Promise<void>;
  readonly active: number;
}

export function shouldRunOnThisShard(definition: TaskDefinition, client: Client<true>): boolean {
  if ((definition.shard ?? "first") === "all") return true;
  const shard = client.shard;
  return shard === null || shard === undefined || shard.ids.includes(0);
}

export function createTaskRunner(options: TaskRunnerOptions): TaskRunner {
  const { tasks, client, logger } = options;
  const intervals = new Set<ReturnType<typeof setInterval>>();
  const running = new Set<Promise<void>>();
  let started = false;

  const launch = (route: CompiledRoute<"task">): (() => void) => {
    const ctx = options.createContext(route);
    let busy = false;
    return () => {
      if (busy) {
        logger.debug(`Skipped task ${route.id}: the previous run is still in progress.`);
        return;
      }
      busy = true;
      const run = (async () => {
        try {
          await route.definition.execute(ctx);
        } catch (error) {
          logger.error(`Task ${route.id} (${route.file}) failed.`, error);
          options.onError?.(error);
        } finally {
          busy = false;
        }
      })();
      running.add(run);
      void run.finally(() => running.delete(run));
    };
  };

  return {
    get active() {
      return running.size;
    },
    start() {
      if (started) return;
      started = true;
      for (const route of tasks) {
        if (!shouldRunOnThisShard(route.definition, client)) {
          logger.debug(`Task ${route.id} runs on the first shard only, skipping on this one.`);
          continue;
        }
        const tick = launch(route);
        const timer = setInterval(tick, parseDuration(route.definition.every));
        timer.unref();
        intervals.add(timer);
        if (route.definition.runOnStart === true) tick();
      }
    },
    async stop() {
      for (const timer of intervals) clearInterval(timer);
      intervals.clear();
      started = false;
      if (running.size === 0) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<void>((resolve) => {
        timer = setTimeout(resolve, TASK_STOP_WAIT_MS);
        timer.unref();
      });
      await Promise.race([Promise.allSettled([...running]), timeout]);
      if (timer !== undefined) clearTimeout(timer);
    },
  };
}

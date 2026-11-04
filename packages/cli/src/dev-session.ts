import { join } from "node:path";
import { CONFIG_FILE_NAMES, findConfigFile, projectPaths, relativePosix, type EntryName } from "./project/paths.ts";
import { errorMessage, CliError } from "./errors.ts";
import type { Ui } from "./ui.ts";
import { bundleEntries } from "./project/bundle.ts";
import { generate } from "./project/codegen.ts";
import { loadConfig, type CliConfig } from "./project/config.ts";
import { applyEnv, envFileNames, loadEnvFiles } from "./project/env.ts";
import { assertNoIssues, runDeployEntry, scanConfigured } from "./project/pipeline.ts";
import { resolveRuntime, type ResolvedRuntime } from "./project/runtime.ts";
import {
  defaultSpawn,
  GRACEFUL_STOP_TIMEOUT_MS,
  IPC_STDIO,
  requestShutdown,
  type ChildHandle,
  type SpawnFunction,
} from "./project/spawn.ts";

export interface DevClock {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface DevWatcher {
  add(paths: string[]): unknown;
  close(): Promise<void>;
}

export type DevWatcherFactory = (paths: string[], onChange: (path: string) => void) => DevWatcher | Promise<DevWatcher>;

export interface DevBuild {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface DevSteps {
  watchPaths(): string[];
  prepare(): Promise<DevBuild>;
  deploy?(build: DevBuild): Promise<void>;
}

export interface DevSessionOptions {
  steps: DevSteps;
  ui: Ui;
  spawn?: SpawnFunction;
  createWatcher: DevWatcherFactory;
  clock?: DevClock;
  debounceMs?: number;
  killTimeoutMs?: number;
}

export interface DevStopOptions {
  childSignalled?: boolean;
}

export const DEFAULT_DEBOUNCE_MS = 100;

const realClock: DevClock = {
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

interface RunningChild {
  handle: ChildHandle;
  exited: Promise<void>;
  markExpected(): void;
}

export class DevSession {
  readonly #steps: DevSteps;
  readonly #ui: Ui;
  readonly #spawn: SpawnFunction;
  readonly #createWatcher: DevWatcherFactory;
  readonly #clock: DevClock;
  readonly #debounceMs: number;
  readonly #killTimeoutMs: number;
  readonly #watched = new Set<string>();

  #watcher: DevWatcher | null = null;
  #child: RunningChild | null = null;
  #debounce: unknown = null;
  #cycle: Promise<void> | null = null;
  #dirty = false;
  #stopped = false;
  #stopping: Promise<number> | null = null;
  #childSignalled = false;
  #interrupts = 0;
  #resolveExit: (code: number) => void = () => {};
  readonly #exit: Promise<number>;

  constructor(options: DevSessionOptions) {
    this.#steps = options.steps;
    this.#ui = options.ui;
    this.#spawn = options.spawn ?? defaultSpawn;
    this.#createWatcher = options.createWatcher;
    this.#clock = options.clock ?? realClock;
    this.#debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.#killTimeoutMs = options.killTimeoutMs ?? GRACEFUL_STOP_TIMEOUT_MS;
    this.#exit = new Promise((resolve) => {
      this.#resolveExit = resolve;
    });
  }

  get running(): boolean {
    return this.#child !== null;
  }

  async start(): Promise<void> {
    const paths = this.#steps.watchPaths();
    for (const path of paths) this.#watched.add(path);
    this.#watcher = await this.#createWatcher(paths, (path) => this.notifyChange(path));
    await this.#runCycles();
  }

  notifyChange(path: string): void {
    if (this.#stopped) return;
    if (this.#debounce !== null) this.#clock.clearTimeout(this.#debounce);
    this.#debounce = this.#clock.setTimeout(() => {
      this.#debounce = null;
      this.#ui.info(`Change detected in ${path}. Rebuilding.`);
      void this.#runCycles();
    }, this.#debounceMs);
  }

  async idle(): Promise<void> {
    while (this.#cycle !== null) await this.#cycle;
  }

  waitForExit(): Promise<number> {
    return this.#exit;
  }

  stop(options: DevStopOptions = {}): Promise<number> {
    if (options.childSignalled === true) this.#childSignalled = true;
    this.#stopping ??= this.#shutdown();
    return this.#stopping;
  }

  interrupt(signal: NodeJS.Signals): Promise<number> {
    this.#interrupts += 1;
    if (this.#interrupts > 1) this.forceKill();
    return this.stop({ childSignalled: signal === "SIGINT" });
  }

  forceKill(): void {
    this.#child?.handle.kill("SIGKILL");
  }

  async #shutdown(): Promise<number> {
    this.#stopped = true;
    if (this.#debounce !== null) {
      this.#clock.clearTimeout(this.#debounce);
      this.#debounce = null;
    }
    await this.#watcher?.close();
    await this.idle();
    await this.#stopChild();
    this.#resolveExit(0);
    return 0;
  }

  #runCycles(): Promise<void> {
    if (this.#cycle !== null) {
      this.#dirty = true;
      return this.#cycle;
    }
    this.#cycle = (async () => {
      try {
        do {
          this.#dirty = false;
          await this.#runOnce();
        } while (this.#dirty && !this.#stopped);
      } finally {
        this.#cycle = null;
      }
    })();
    return this.#cycle;
  }

  #syncWatchPaths(): void {
    const added = this.#steps.watchPaths().filter((path) => !this.#watched.has(path));
    if (added.length === 0) return;
    for (const path of added) this.#watched.add(path);
    if (!this.#stopped) this.#watcher?.add(added);
  }

  async #runOnce(): Promise<void> {
    let build: DevBuild;
    try {
      build = await this.#steps.prepare();
    } catch (error) {
      this.#syncWatchPaths();
      this.#ui.reportError(error);
      await this.#stopChild();
      if (!this.#stopped) this.#ui.info("Waiting for changes.");
      return;
    }
    this.#syncWatchPaths();
    if (this.#dirty || this.#stopped) return;

    await this.#stopChild();
    if (this.#stopped) return;

    if (this.#steps.deploy) {
      try {
        await this.#steps.deploy(build);
      } catch (error) {
        this.#ui.warn(`Command sync failed: ${errorMessage(error)}`);
      }
    }
    if (this.#dirty || this.#stopped) return;

    this.#startChild(build);
  }

  #startChild(build: DevBuild): void {
    const handle = this.#spawn(build.command, build.args, {
      cwd: build.cwd,
      env: build.env,
      stdio: IPC_STDIO,
    });
    let expected = false;
    let settled = false;
    let resolveExited: () => void = () => {};
    const exited = new Promise<void>((resolve) => {
      resolveExited = resolve;
    });
    const child: RunningChild = {
      handle,
      exited,
      markExpected: () => {
        expected = true;
      },
    };
    const finish = (describe: () => string): void => {
      if (settled) return;
      settled = true;
      if (this.#child === child) this.#child = null;
      if (!expected && !this.#stopped) {
        this.#ui.warn(`${describe()} Waiting for changes.`);
      }
      resolveExited();
    };
    handle.on("exit", (code, signal) => {
      finish(() => (signal ? `Bot stopped by ${signal}.` : `Bot exited with code ${code ?? 0}.`));
    });
    handle.on("error", (error) => {
      finish(() => `Bot failed to start: ${errorMessage(error)}.`);
    });
    this.#child = child;
    this.#ui.success("Bot started.");
  }

  async #stopChild(): Promise<void> {
    const child = this.#child;
    if (child === null) return;
    child.markExpected();
    requestShutdown(child.handle, () => {
      if (!this.#childSignalled) child.handle.kill("SIGTERM");
    });
    const timer = this.#clock.setTimeout(() => {
      child.handle.kill("SIGKILL");
    }, this.#killTimeoutMs);
    await child.exited;
    this.#clock.clearTimeout(timer);
  }
}

export interface DevStepsOptions {
  root: string;
  ui: Ui;
  shards?: number | undefined;
  deploy: boolean;
  baseEnv?: Record<string, string | undefined>;
  spawn?: SpawnFunction;
}

export function devWatchPaths(root: string, config: Pick<CliConfig, "sourceDir" | "featuresDir"> | null): string[] {
  const sourceDir = config?.sourceDir ?? "src";
  const featuresDir = config?.featuresDir ?? `${sourceDir}/features`;
  const directories = featuresDir.startsWith(`${sourceDir}/`) ? [sourceDir] : [sourceDir, featuresDir];
  const files = [...CONFIG_FILE_NAMES, ...envFileNames("development"), "tsconfig.json"];
  return [...directories, ...files].map((path) => join(root, path));
}

export function createDevSteps(options: DevStepsOptions): DevSteps {
  const root = options.root;
  const paths = projectPaths(root);
  const baseEnv = { ...(options.baseEnv ?? process.env) };
  let config: CliConfig | null = null;
  let runtime: ResolvedRuntime | null = null;
  let warnedAboutGuild = false;

  const steps: DevSteps = {
    watchPaths: () => devWatchPaths(root, config),

    async prepare() {
      const loaded = loadEnvFiles({ root, mode: "development", env: baseEnv });
      applyEnv(process.env, loaded.env);

      const configFile = findConfigFile(root);
      if (configFile === null) {
        throw new CliError(`No neocord.config file found in "${root}".`);
      }
      const nextConfig = (await loadConfig({ root, configFile })).config;
      config = nextConfig;
      runtime = resolveRuntime(nextConfig.runtime);

      const scan = await scanConfigured(root, nextConfig);
      assertNoIssues(scan);
      await generate(scan, { configFile });

      const shards = options.shards ?? nextConfig.dev.shards;
      const entries: EntryName[] = shards > 1 ? ["shard", "manager", "deploy"] : ["shard", "deploy"];
      const bundle = await bundleEntries({ root, entries, outDir: paths.devDir });
      for (const warning of bundle.warnings) options.ui.warn(warning);

      return {
        command: runtime.command,
        args: [...runtime.args, join(paths.devDir, shards > 1 ? "manager.js" : "shard.js")],
        cwd: root,
        env: {
          ...loaded.env,
          ...(shards > 1 ? { NEOCORD_SHARD_COUNT: String(shards) } : {}),
        },
      };
    },
  };

  if (options.deploy) {
    steps.deploy = async (build) => {
      const guildId = config?.dev.guildId;
      if (guildId === undefined) {
        if (!warnedAboutGuild) {
          options.ui.warn("No dev.guildId set, so commands are not synced in development.");
          warnedAboutGuild = true;
        }
        return;
      }
      if (runtime === null) return;
      const run = await runDeployEntry({
        file: join(paths.devDir, "deploy.js"),
        stateFile: paths.devDeployState,
        options: { guildId },
        env: build.env,
        root,
        runtime,
        ...(options.spawn ? { spawn: options.spawn } : {}),
      });
      if (run.code !== 0 || run.result === null) {
        throw new CliError(`the deploy process exited with code ${run.code}`);
      }
      if (run.result.result.status === "deployed") {
        options.ui.success(`Synced ${run.result.result.commandCount} commands to guild ${guildId}.`);
      }
    };
  }

  return steps;
}

export function createChokidarWatcher(root: string): DevWatcherFactory {
  return async (paths, onChange) => {
    const { watch } = await import("chokidar");
    const ignored = (path: string): boolean => {
      const inside = relativePosix(root, path);
      return /(^|\/)(node_modules|\.neocord|\.git)(\/|$)/.test(inside) || /\.(test|spec)\.tsx?$/.test(inside);
    };
    const watcher = watch(paths, { ignoreInitial: true, ignored });
    watcher.on("all", (_event, path) => onChange(relativePosix(root, path)));
    return watcher;
  };
}

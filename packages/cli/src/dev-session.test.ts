import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import {
  createChokidarWatcher,
  createDevSteps,
  DevSession,
  devWatchPaths,
  type DevBuild,
  type DevClock,
  type DevSteps,
  type DevWatcher,
  type DevWatcherFactory,
} from "./dev-session.ts";
import { applyEnv } from "./project/env.ts";
import type { ChildHandle, SpawnFunction } from "./project/spawn.ts";
import {
  createCapture,
  createFixture,
  LONG_TIMEOUT,
  STANDARD_FILES,
  waitUntil,
  type Fixture,
} from "./test-support/fixture.ts";
import { Ui } from "./ui.ts";

class FakeChild extends EventEmitter {
  readonly signals: (NodeJS.Signals | undefined)[] = [];
  exitOnTerm = true;

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal);
    if (this.exitOnTerm || signal === "SIGKILL") {
      queueMicrotask(() => this.emit("exit", null, signal ?? "SIGTERM"));
    }
    return true;
  }

  crash(code: number): void {
    this.emit("exit", code, null);
  }
}

class FakeClock implements DevClock {
  #now = 0;
  #timers = new Map<number, { at: number; callback: () => void }>();
  #next = 1;

  setTimeout(callback: () => void, ms: number): unknown {
    const id = this.#next++;
    this.#timers.set(id, { at: this.#now + ms, callback });
    return id;
  }

  clearTimeout(handle: unknown): void {
    this.#timers.delete(handle as number);
  }

  advance(ms: number): void {
    this.#now += ms;
    for (const [id, timer] of [...this.#timers]) {
      if (timer.at <= this.#now) {
        this.#timers.delete(id);
        timer.callback();
      }
    }
  }

  get pending(): number {
    return this.#timers.size;
  }
}

class FakeWatcher implements DevWatcher {
  readonly paths: string[];
  readonly onChange: (path: string) => void;
  closed = false;

  constructor(paths: string[], onChange: (path: string) => void) {
    this.paths = [...paths];
    this.onChange = onChange;
  }

  add(paths: string[]): void {
    this.paths.push(...paths);
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

interface Harness {
  session: DevSession;
  clock: FakeClock;
  children: FakeChild[];
  spawned: { command: string; args: readonly string[]; env: Record<string, string> }[];
  watcher(): FakeWatcher;
  output(): string;
  errors(): string;
  change(path?: string): Promise<void>;
}

function harness(steps: DevSteps): Harness {
  const stdout = createCapture();
  const stderr = createCapture();
  const ui = new Ui({ stdout: stdout.stream, stderr: stderr.stream, env: {} });
  const clock = new FakeClock();
  const children: FakeChild[] = [];
  const spawned: Harness["spawned"] = [];
  let watcher: FakeWatcher | null = null;

  const spawn: SpawnFunction = (command, args, options) => {
    const child = new FakeChild();
    children.push(child);
    spawned.push({ command, args, env: options.env as Record<string, string> });
    return child as unknown as ChildHandle;
  };
  const createWatcher: DevWatcherFactory = (paths, onChange) => {
    watcher = new FakeWatcher(paths, onChange);
    return watcher;
  };

  const session = new DevSession({ steps, ui, spawn, createWatcher, clock });
  return {
    session,
    clock,
    children,
    spawned,
    watcher: () => {
      if (watcher === null) throw new Error("watcher not created");
      return watcher;
    },
    output: () => stdout.text(),
    errors: () => stderr.text(),
    async change(path = "src/file.ts") {
      watcher?.onChange(path);
      clock.advance(100);
      await session.idle();
    },
  };
}

function stubSteps(overrides: Partial<DevSteps> & { prepares?: { count: number } } = {}): DevSteps {
  const prepares = overrides.prepares ?? { count: 0 };
  const build: DevBuild = { command: "runtime", args: ["shard.js"], cwd: "root", env: {} };
  return {
    watchPaths: () => ["src"],
    prepare: async () => {
      prepares.count += 1;
      return build;
    },
    ...overrides,
  };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 5; index++) await Promise.resolve();
}

describe("DevSession", () => {
  test("starts the child once on start and watches the requested paths", async () => {
    const test = harness(stubSteps());
    await test.session.start();
    expect(test.children).toHaveLength(1);
    expect(test.spawned[0]).toMatchObject({ command: "runtime", args: ["shard.js"] });
    expect(test.watcher().paths).toEqual(["src"]);
    expect(test.output()).toContain("Bot started.");
  });

  test("debounces bursts of changes into one restart at 100ms", async () => {
    const prepares = { count: 0 };
    const test = harness(stubSteps({ prepares }));
    await test.session.start();
    expect(prepares.count).toBe(1);

    const notify = test.watcher().onChange;
    notify("a.ts");
    test.clock.advance(60);
    notify("b.ts");
    test.clock.advance(60);
    notify("c.ts");
    test.clock.advance(99);
    await settle();
    expect(prepares.count).toBe(1);

    test.clock.advance(1);
    await test.session.idle();
    expect(prepares.count).toBe(2);
    expect(test.children).toHaveLength(2);
    expect(test.output()).toContain("c.ts");
  });

  test("stops the previous child with SIGTERM before starting the next", async () => {
    const test = harness(stubSteps());
    await test.session.start();
    await test.change();
    expect(test.children[0]?.signals).toEqual(["SIGTERM"]);
    expect(test.children[1]?.signals).toEqual([]);
    expect(test.clock.pending).toBe(0);
  });

  test("force kills a child that ignores SIGTERM after 5 seconds", async () => {
    const test = harness(stubSteps());
    await test.session.start();
    const first = test.children[0];
    if (!first) throw new Error("no child");
    first.exitOnTerm = false;

    test.watcher().onChange("a.ts");
    test.clock.advance(100);
    await settle();
    expect(first.signals).toEqual(["SIGTERM"]);
    expect(test.children).toHaveLength(1);

    test.clock.advance(4999);
    await settle();
    expect(first.signals).toEqual(["SIGTERM"]);

    test.clock.advance(1);
    await test.session.idle();
    expect(first.signals).toEqual(["SIGTERM", "SIGKILL"]);
    expect(test.children).toHaveLength(2);
  });

  test("prints the exit code when the child crashes and does not restart in a loop", async () => {
    const prepares = { count: 0 };
    const test = harness(stubSteps({ prepares }));
    await test.session.start();

    test.children[0]?.crash(3);
    await settle();
    expect(test.errors()).toContain("Bot exited with code 3. Waiting for changes.");
    expect(test.session.running).toBe(false);

    test.clock.advance(60_000);
    await test.session.idle();
    expect(test.children).toHaveLength(1);
    expect(prepares.count).toBe(1);

    await test.change();
    expect(test.children).toHaveLength(2);
    expect(test.session.running).toBe(true);
  });

  test("does not report an expected stop as a crash", async () => {
    const test = harness(stubSteps());
    await test.session.start();
    await test.change();
    expect(test.errors()).toBe("");
  });

  test("reports a child that fails to spawn and keeps waiting", async () => {
    const test = harness(stubSteps());
    await test.session.start();
    test.children[0]?.emit("error", new Error("spawn ENOENT"));
    await settle();
    expect(test.errors()).toContain("Bot failed to start: spawn ENOENT.");
    expect(test.session.running).toBe(false);
    await test.change();
    expect(test.children).toHaveLength(2);
  });

  test("a failed build leaves the child stopped until the next successful one", async () => {
    let fail = false;
    const test = harness(
      stubSteps({
        prepare: async () => {
          if (fail) throw new Error("bundle exploded");
          return { command: "runtime", args: [], cwd: "root", env: {} };
        },
      }),
    );
    await test.session.start();

    fail = true;
    await test.change();
    expect(test.errors()).toContain("bundle exploded");
    expect(test.children[0]?.signals).toEqual(["SIGTERM"]);
    expect(test.children).toHaveLength(1);
    expect(test.session.running).toBe(false);
    expect(test.watcher().closed).toBe(false);

    await test.change();
    expect(test.children).toHaveLength(1);

    fail = false;
    await test.change();
    expect(test.children).toHaveLength(2);
    expect(test.session.running).toBe(true);
  });

  test("a failing first build still watches for the fix", async () => {
    let fail = true;
    const test = harness(
      stubSteps({
        prepare: async () => {
          if (fail) throw new Error("nope");
          return { command: "runtime", args: [], cwd: "root", env: {} };
        },
      }),
    );
    await test.session.start();
    expect(test.children).toHaveLength(0);
    fail = false;
    await test.change();
    expect(test.children).toHaveLength(1);
  });

  test("a change during a build rebuilds again and starts only the newest result", async () => {
    let release: () => void = () => {};
    let prepares = 0;
    const test = harness(
      stubSteps({
        prepare: async () => {
          prepares += 1;
          if (prepares === 2) await new Promise<void>((resolve) => (release = resolve));
          return { command: "runtime", args: [String(prepares)], cwd: "root", env: {} };
        },
      }),
    );
    await test.session.start();

    test.watcher().onChange("a.ts");
    test.clock.advance(100);
    await settle();
    expect(prepares).toBe(2);

    test.watcher().onChange("b.ts");
    test.clock.advance(100);
    release();
    await test.session.idle();

    expect(prepares).toBe(3);
    expect(test.spawned.map((item) => item.args[0])).toEqual(["1", "3"]);
  });

  test("runs the deploy step before starting and survives its failure", async () => {
    const order: string[] = [];
    let fail = false;
    const test = harness(
      stubSteps({
        deploy: async () => {
          order.push(`deploy with ${test.children.length} children`);
          if (fail) throw new Error("rate limited");
        },
      }),
    );
    await test.session.start();
    expect(order).toEqual(["deploy with 0 children"]);
    expect(test.children).toHaveLength(1);

    fail = true;
    await test.change();
    expect(test.errors()).toContain("Command sync failed: rate limited");
    expect(test.children).toHaveLength(2);
  });

  test("stop closes the watcher, stops the child and exits 0", async () => {
    const test = harness(stubSteps());
    await test.session.start();
    const exit = test.session.waitForExit();

    expect(await test.session.stop()).toBe(0);
    expect(await exit).toBe(0);
    expect(test.watcher().closed).toBe(true);
    expect(test.children[0]?.signals).toEqual(["SIGTERM"]);
    expect(test.errors()).toBe("");

    test.watcher().onChange("late.ts");
    test.clock.advance(1000);
    await test.session.idle();
    expect(test.children).toHaveLength(1);
  });

  test("stop during a build does not start a child", async () => {
    let release: () => void = () => {};
    const test = harness(
      stubSteps({
        prepare: async () => {
          await new Promise<void>((resolve) => (release = resolve));
          return { command: "runtime", args: [], cwd: "root", env: {} };
        },
      }),
    );
    const starting = test.session.start();
    await settle();
    const stopping = test.session.stop();
    release();
    await starting;
    expect(await stopping).toBe(0);
    expect(test.children).toHaveLength(0);
  });

  test("adds newly configured watch paths", async () => {
    let paths = ["src"];
    const test = harness(stubSteps({ watchPaths: () => paths }));
    await test.session.start();
    paths = ["src", "modules"];
    await test.change();
    expect(test.watcher().paths).toEqual(["src", "modules"]);
  });
});

describe("devWatchPaths", () => {
  test("covers the source folder, config, env files and tsconfig for a spaced root", () => {
    const root = join("C:", "my project");
    const paths = devWatchPaths(root, { sourceDir: "app", featuresDir: "app/features" });
    expect(paths).toContain(join(root, "app"));
    expect(paths).toContain(join(root, "neocord.config.ts"));
    expect(paths).toContain(join(root, "neocord.config.mjs"));
    expect(paths).toContain(join(root, ".env"));
    expect(paths).toContain(join(root, ".env.development.local"));
    expect(paths).toContain(join(root, "tsconfig.json"));
  });
});

describe("DevSession with real project steps", () => {
  let fixture: Fixture;
  let envBefore: Record<string, string>;

  beforeEach(() => {
    envBefore = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
  });

  afterEach(() => {
    applyEnv(process.env, envBefore);
    fixture.cleanup();
  });

  function realHarness(options: { deploy?: boolean; shards?: number } = {}): Harness {
    const stderr = createCapture();
    const stdout = createCapture();
    const ui = new Ui({ stdout: stdout.stream, stderr: stderr.stream, env: {} });
    const inner = harness(
      createDevSteps({
        root: fixture.root,
        ui,
        deploy: options.deploy ?? false,
        ...(options.shards ? { shards: options.shards } : {}),
      }),
    );
    return { ...inner, errors: () => `${inner.errors()}${stderr.text()}` };
  }

  test(
    "a bundle failure stops the child, then the fix recovers",
    async () => {
      fixture = createFixture({ files: STANDARD_FILES });
      const test = realHarness();
      await test.session.start();
      expect(test.children).toHaveLength(1);
      expect(fixture.exists(".neocord/dev/shard.js")).toBe(true);
      expect(fixture.exists(".neocord/build/shard.js")).toBe(false);

      fixture.write("src/features/general/commands/ping/command.tsx", "export default {");
      await test.change();
      expect(test.errors()).toContain("Bundling failed");
      expect(test.errors()).toContain("src/features/general/commands/ping/command.tsx:1:");
      expect(test.session.running).toBe(false);
      expect(test.children).toHaveLength(1);

      fixture.write("src/features/general/commands/ping/command.tsx", 'export default { __neocord: "command" };\n');
      await test.change();
      expect(test.children).toHaveLength(2);
      expect(test.session.running).toBe(true);
    },
    LONG_TIMEOUT,
  );

  test(
    "invalid files are shown with their reason and the session keeps watching",
    async () => {
      fixture = createFixture({ files: STANDARD_FILES });
      const test = realHarness();
      await test.session.start();

      fixture.write("src/features/general/commands/ping/helper.ts", "export {};\n");
      await test.change();
      expect(test.errors()).toContain("src/features/general/commands/ping/helper.ts");
      expect(test.errors()).toContain('must be named "command.ts"');
      expect(test.session.running).toBe(false);
      expect(test.watcher().closed).toBe(false);

      fixture.remove("src/features/general/commands/ping/helper.ts");
      await test.change();
      expect(test.session.running).toBe(true);
    },
    LONG_TIMEOUT,
  );

  test(
    "reloads env files and config on change",
    async () => {
      fixture = createFixture({
        files: { ...STANDARD_FILES, ".env": "FIXTURE_VALUE=first\nREMOVED_LATER=yes\n" },
        config: `export default { dev: { shards: 1 } };\n`,
      });
      const test = realHarness();
      await test.session.start();
      expect(test.spawned[0]?.env.NODE_ENV).toBe("development");
      expect(test.spawned[0]?.env.FIXTURE_VALUE).toBe("first");
      expect(test.spawned[0]?.env.SKIP_ENV_VALIDATION).toBeUndefined();
      expect(test.spawned[0]?.args.at(-1)).toEndWith("shard.js");

      fixture.write(".env", "FIXTURE_VALUE=second\n");
      fixture.write("neocord.config.ts", "export default { dev: { shards: 3 } };\n");
      await test.change(".env");

      expect(test.spawned[1]?.env.FIXTURE_VALUE).toBe("second");
      expect(test.spawned[1]?.env.REMOVED_LATER).toBeUndefined();
      expect(process.env.REMOVED_LATER).toBeUndefined();
      expect(test.spawned[1]?.env.NEOCORD_SHARD_COUNT).toBe("3");
      expect(test.spawned[1]?.args.at(-1)).toEndWith("manager.js");
      expect(fixture.exists(".neocord/dev/manager.js")).toBe(true);
    },
    LONG_TIMEOUT,
  );

  test(
    "--shards overrides dev.shards",
    async () => {
      fixture = createFixture({ files: STANDARD_FILES });
      const test = realHarness({ shards: 2 });
      await test.session.start();
      expect(test.spawned[0]?.env.NEOCORD_SHARD_COUNT).toBe("2");
      expect(test.spawned[0]?.args.at(-1)).toEndWith("manager.js");
    },
    LONG_TIMEOUT,
  );

  test(
    "env validation failures are readable and never skipped in dev",
    async () => {
      fixture = createFixture({
        config: `import "./src/env";\nexport default {};\n`,
        files: {
          ...STANDARD_FILES,
          "src/env.ts": `if (!process.env.DEV_TEST_TOKEN || process.env.SKIP_ENV_VALIDATION) {
  console.error("Invalid environment variables:", [{ path: ["DEV_TEST_TOKEN"], message: "Required" }]);
  throw new Error("Invalid environment variables");
}
export {};
`,
        },
      });
      const test = realHarness();
      await test.session.start();
      expect(test.children).toHaveLength(0);
      expect(test.errors()).toContain("Environment validation failed.");
      expect(test.errors()).toContain("DEV_TEST_TOKEN: Required");

      fixture.write(".env", "DEV_TEST_TOKEN=present\n");
      await test.change(".env");
      expect(test.children).toHaveLength(1);
    },
    LONG_TIMEOUT,
  );

  test(
    "syncs commands to dev.guildId through the deploy entry",
    async () => {
      fixture = createFixture({
        files: STANDARD_FILES,
        config: `export default { dev: { guildId: "555" } };\n`,
      });
      const test = realHarness({ deploy: true });
      await test.session.start();
      const deploy = fixture.calls().find((call) => call.call === "deployCommands");
      expect(deploy).toMatchObject({ guildId: "555", dryRun: false });
      expect(String(deploy?.stateFile)).toEndWith(join(".neocord", "deploy.dev.json"));
      expect(test.children).toHaveLength(1);
    },
    LONG_TIMEOUT,
  );

  test(
    "warns once when there is no dev.guildId and skips the deploy",
    async () => {
      fixture = createFixture({ files: STANDARD_FILES });
      const stderr = createCapture();
      const steps = createDevSteps({
        root: fixture.root,
        ui: new Ui({ stdout: createCapture().stream, stderr: stderr.stream, env: {} }),
        deploy: true,
      });
      const test = harness(steps);
      await test.session.start();
      await test.change();
      expect(stderr.text().match(/No dev\.guildId set/g)).toHaveLength(1);
      expect(fixture.calls().some((call) => call.call === "deployCommands")).toBe(false);
    },
    LONG_TIMEOUT,
  );

  test(
    "--no-deploy skips syncing even with a guild",
    async () => {
      fixture = createFixture({
        files: STANDARD_FILES,
        config: `export default { dev: { guildId: "555" } };\n`,
      });
      const test = realHarness({ deploy: false });
      await test.session.start();
      expect(fixture.calls().some((call) => call.call === "deployCommands")).toBe(false);
      expect(test.errors()).not.toContain("guildId");
    },
    LONG_TIMEOUT,
  );

  test(
    "restarts a real stub child when a real watcher sees a change",
    async () => {
      fixture = createFixture({ files: STANDARD_FILES });
      const stdout = createCapture();
      const stderr = createCapture();
      const ui = new Ui({ stdout: stdout.stream, stderr: stderr.stream, env: {} });
      const session = new DevSession({
        steps: createDevSteps({
          root: fixture.root,
          ui,
          deploy: false,
          baseEnv: { ...process.env, STUB_STAY_ALIVE: "1" },
        }),
        ui,
        createWatcher: createChokidarWatcher(fixture.root),
      });
      const startBots = (): number => fixture.calls().filter((call) => call.call === "startBot").length;

      await session.start();
      try {
        await waitUntil(() => startBots() === 1);
        expect(session.running).toBe(true);

        await new Promise((resolve) => setTimeout(resolve, 300));
        fixture.write("src/features/general/commands/ping/command.tsx", 'export default { __neocord: "command", v: 2 };\n');
        await waitUntil(() => startBots() === 2);
        expect(session.running).toBe(true);

        fixture.write(".env", "FIXTURE_VALUE=from-new-env-file\n");
        await waitUntil(() => startBots() === 3);
        expect(fixture.calls().at(-1)?.env.FIXTURE_VALUE).toBe("from-new-env-file");
      } finally {
        expect(await session.stop()).toBe(0);
      }
      expect(session.running).toBe(false);
      expect(stderr.text()).toBe("");
      expect(stdout.text()).toContain("Change detected in src/features/general/commands/ping/command.tsx");
    },
    LONG_TIMEOUT,
  );
});

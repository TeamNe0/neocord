import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { constants } from "node:os";
import { createFixture, LONG_TIMEOUT, nodeCommand } from "../test-support/fixture.ts";
import {
  exitCodeFor,
  forwardSignals,
  GRACEFUL_STOP_TIMEOUT_MS,
  runProcess,
  runTaggedProcess,
  type ChildHandle,
  type SignalSource,
} from "./spawn.ts";

class FakeChild extends EventEmitter {
  readonly signals: (NodeJS.Signals | undefined)[] = [];
  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal);
    return true;
  }
}

function asHandle(child: FakeChild): ChildHandle {
  return child as unknown as ChildHandle;
}

function signalSource(): EventEmitter & SignalSource {
  return new EventEmitter() as EventEmitter & SignalSource;
}

describe("exitCodeFor", () => {
  test("uses the exit code, then the conventional signal code", () => {
    expect(exitCodeFor(7, null)).toBe(7);
    expect(exitCodeFor(0, null)).toBe(0);
    expect(exitCodeFor(null, "SIGTERM")).toBe(128 + constants.signals.SIGTERM);
    expect(exitCodeFor(null, null)).toBe(1);
  });
});

describe("forwardSignals", () => {
  test("forwards signals and detaches cleanly on POSIX", () => {
    const child = new FakeChild();
    const source = signalSource();
    const detach = forwardSignals(asHandle(child), { source, platform: "linux" });
    source.emit("SIGINT");
    source.emit("SIGTERM");
    source.emit("SIGHUP");
    expect(child.signals).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
    detach();
    source.emit("SIGTERM");
    expect(child.signals).toHaveLength(3);
    expect(source.listenerCount("SIGTERM")).toBe(0);
  });

  test("gives a Windows console child time to handle Ctrl+C before killing it", async () => {
    const child = new FakeChild();
    const source = signalSource();
    const detach = forwardSignals(asHandle(child), { source, platform: "win32", consoleGraceMs: 10 });
    source.emit("SIGINT");
    expect(child.signals).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(child.signals).toEqual(["SIGINT"]);
    detach();
  });

  test("the default Windows grace period covers the graceful stop budget", async () => {
    const realSetTimeout = globalThis.setTimeout;
    const delays: (number | undefined)[] = [];
    const recording = ((callback: () => void, ms?: number) => {
      delays.push(ms);
      return realSetTimeout(callback, 0);
    }) as unknown as typeof setTimeout;
    globalThis.setTimeout = recording;
    try {
      const child = new FakeChild();
      const source = signalSource();
      const detach = forwardSignals(asHandle(child), { source, platform: "win32" });
      source.emit("SIGINT");
      detach();
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    expect(delays).toEqual([GRACEFUL_STOP_TIMEOUT_MS]);
  });

  test("cancels the Windows grace timer once the child exits", async () => {
    const child = new FakeChild();
    const source = signalSource();
    const detach = forwardSignals(asHandle(child), { source, platform: "win32", consoleGraceMs: 10 });
    source.emit("SIGINT");
    detach();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(child.signals).toEqual([]);
  });
});

const scriptEnv = { PATH: process.env.PATH ?? "" };

describe("runProcess", () => {
  test(
    "propagates the exit code and runs paths containing spaces",
    async () => {
      const fixture = createFixture({ stubs: false, files: { "my scripts/exit.mjs": "process.exit(Number(process.argv[2]));\n" } });
      try {
        const result = await runProcess({
          command: nodeCommand(),
          args: [`${fixture.root}/my scripts/exit.mjs`, "42"],
          cwd: fixture.root,
          env: scriptEnv,
          stdio: "ignore",
        });
        expect(result).toEqual({ code: 42, signal: null });
      } finally {
        fixture.cleanup();
      }
    },
    LONG_TIMEOUT,
  );

  test(
    "passes arguments literally, without a shell",
    async () => {
      const fixture = createFixture({
        stubs: false,
        files: {
          "args.mjs": `import { writeFileSync } from "node:fs";\nwriteFileSync("args.json", JSON.stringify(process.argv.slice(2)));\n`,
        },
      });
      try {
        const hostile = ["a b", "&& echo hacked", "$(whoami)", "%PATH%", '"quoted"'];
        await runProcess({
          command: nodeCommand(),
          args: [`${fixture.root}/args.mjs`, ...hostile],
          cwd: fixture.root,
          env: scriptEnv,
          stdio: "ignore",
        });
        expect(JSON.parse(fixture.read("args.json"))).toEqual(hostile);
      } finally {
        fixture.cleanup();
      }
    },
    LONG_TIMEOUT,
  );

  test(
    "forwards a signal to a real child and reports it in the exit code",
    async () => {
      const fixture = createFixture({
        stubs: false,
        files: {
          "wait.mjs": `import { writeFileSync } from "node:fs";\nsetInterval(() => {}, 1000);\nwriteFileSync("ready", "");\n`,
        },
      });
      try {
        const source = signalSource();
        const running = runProcess({
          command: nodeCommand(),
          args: [`${fixture.root}/wait.mjs`],
          cwd: fixture.root,
          env: scriptEnv,
          stdio: "ignore",
          source,
        });
        while (!fixture.exists("ready")) await new Promise((resolve) => setTimeout(resolve, 20));
        source.emit("SIGTERM");
        const result = await running;
        expect(result.signal).toBe("SIGTERM");
        expect(result.code).toBe(128 + constants.signals.SIGTERM);
        expect(source.listenerCount("SIGTERM")).toBe(0);
      } finally {
        fixture.cleanup();
      }
    },
    LONG_TIMEOUT,
  );

  test.skipIf(process.platform === "win32")(
    "lets a child exit gracefully with its own code after a forwarded signal",
    async () => {
      const fixture = createFixture({
        stubs: false,
        files: {
          "wait.mjs": `import { writeFileSync } from "node:fs";\nprocess.on("SIGTERM", () => process.exit(9));\nsetInterval(() => {}, 1000);\nwriteFileSync("ready", "");\n`,
        },
      });
      try {
        const source = signalSource();
        const running = runProcess({
          command: nodeCommand(),
          args: [`${fixture.root}/wait.mjs`],
          cwd: fixture.root,
          env: scriptEnv,
          stdio: "ignore",
          source,
        });
        while (!fixture.exists("ready")) await new Promise((resolve) => setTimeout(resolve, 20));
        source.emit("SIGTERM");
        expect((await running).code).toBe(9);
      } finally {
        fixture.cleanup();
      }
    },
    LONG_TIMEOUT,
  );

  test("rejects with a readable error when the command cannot start", async () => {
    await expect(
      runProcess({ command: "definitely-not-a-real-command-xyz", args: [], cwd: process.cwd(), env: scriptEnv, stdio: "ignore" }),
    ).rejects.toThrow("Could not start definitely-not-a-real-command-xyz");
  });
});

describe("runTaggedProcess", () => {
  test(
    "extracts the tagged line and passes every other line through",
    async () => {
      const fixture = createFixture({
        stubs: false,
        files: {
          "tagged.mjs": [
            'console.log("hello");',
            'console.log(JSON.stringify({ neocord: "other", value: 1 }));',
            'console.log(JSON.stringify({ neocord: "deploy", result: { ok: true } }));',
            'process.stdout.write("no newline");',
            "",
          ].join("\n"),
        },
      });
      try {
        const lines: string[] = [];
        const run = await runTaggedProcess<{ result: { ok: boolean } }>(
          { command: nodeCommand(), args: [`${fixture.root}/tagged.mjs`], cwd: fixture.root, env: scriptEnv },
          "deploy",
          (line) => lines.push(line),
        );
        expect(run.code).toBe(0);
        expect(run.result?.result).toEqual({ ok: true });
        expect(lines).toEqual(["hello", '{"neocord":"other","value":1}', "no newline"]);
      } finally {
        fixture.cleanup();
      }
    },
    LONG_TIMEOUT,
  );
});

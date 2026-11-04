import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { CANCEL_SYMBOL } from "@clack/prompts";
import { CommanderError } from "commander";
import {
  CancelledError,
  CliError,
  type CliLogger,
  main,
  nextSteps,
  type ParsedArgs,
  parseArgs,
  type Prompter,
  resolveOptions,
} from "./cli.ts";
import { detectPackageManager, installCommand, runScriptCommand } from "./package-manager.ts";
import { resolveProjectTarget, validatePackageName } from "./project.ts";

let root: string;
let counter = 0;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "create-neocord-cli-"));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

function nextDir(): string {
  counter += 1;
  const directory = join(root, `cwd-${counter}`);
  mkdirSync(directory);
  return directory;
}

const silent = { writeOut: () => {}, writeErr: () => {} };

function parse(...args: string[]): ParsedArgs {
  return parseArgs(args, silent);
}

function neverPrompt(): Prompter {
  const fail = () => {
    throw new Error("prompted in non-interactive mode");
  };
  return { text: fail, select: fail, confirm: fail };
}

function scriptedPrompter(answers: Record<string, string | boolean | symbol>): Prompter {
  const answer = (message: string) => {
    const key = Object.keys(answers).find((candidate) => message.includes(candidate));
    if (key === undefined) throw new Error(`unexpected prompt: ${message}`);
    return answers[key];
  };
  return {
    text: async ({ message }) => answer(message) as string | symbol,
    select: async <Value extends string>({ message }: { message: string }) => answer(message) as Value | symbol,
    confirm: async ({ message }) => answer(message) as boolean | symbol,
  };
}

function capturingLogger(): CliLogger & { messages: string[] } {
  const messages: string[] = [];
  const record = (message: string) => {
    messages.push(message);
  };
  return {
    messages,
    intro: record,
    step: record,
    warn: record,
    error: record,
    outro: record,
    cancel: record,
    note: record,
  };
}

function expectCommanderExit(args: string[], code: string, exitCode: number): void {
  try {
    parse(...args);
  } catch (error) {
    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe(code);
    expect((error as CommanderError).exitCode).toBe(exitCode);
    return;
  }
  throw new Error(`expected ${args.join(" ")} to exit`);
}

describe("parseArgs", () => {
  test("defaults every optional flag to undefined", () => {
    expect(parse()).toEqual({ flags: { yes: false, force: false } });
  });

  test("reads the directory and every flag", () => {
    expect(
      parse("my-bot", "--db", "prisma", "--dialect", "mysql", "--eslint", "--git", "--install", "--pm", "pnpm", "--yes", "--force"),
    ).toEqual({
      dir: "my-bot",
      flags: {
        db: "prisma",
        dialect: "mysql",
        eslint: true,
        git: true,
        install: true,
        pm: "pnpm",
        yes: true,
        force: true,
      },
    });
  });

  test("reads negated flags", () => {
    expect(parse("--no-eslint", "--no-git", "--no-install").flags).toMatchObject({
      eslint: false,
      git: false,
      install: false,
    });
  });

  test("rejects invalid choices", () => {
    expectCommanderExit(["--db", "mongo"], "commander.invalidArgument", 1);
    expectCommanderExit(["--dialect", "oracle"], "commander.invalidArgument", 1);
    expectCommanderExit(["--pm", "deno"], "commander.invalidArgument", 1);
  });

  test("rejects unknown flags and extra arguments", () => {
    expectCommanderExit(["--nope"], "commander.unknownOption", 1);
    expectCommanderExit(["one", "two"], "commander.excessArguments", 1);
  });

  test("help and version exit cleanly", () => {
    expectCommanderExit(["--help"], "commander.helpDisplayed", 0);
    expectCommanderExit(["--version"], "commander.version", 0);
  });
});

describe("validatePackageName", () => {
  test("accepts valid names", () => {
    for (const name of ["bot", "my-bot", "my.bot_2", "@scope/my-bot"]) {
      expect(validatePackageName(name)).toBeUndefined();
    }
  });

  test("rejects invalid names", () => {
    for (const name of ["", "My-Bot", "my bot", ".bot", "_bot", "bot!", "node_modules", "favicon.ico", "http", "a/b", "@scope/.bot", "x".repeat(215)]) {
      expect(validatePackageName(name)).toBeString();
    }
  });
});

describe("resolveProjectTarget", () => {
  const cwd = resolve(tmpdir(), "some-project");

  test("uses the cwd name for a dot", () => {
    expect(resolveProjectTarget(".", cwd)).toEqual({ packageName: "some-project", targetDir: cwd });
  });

  test("uses the last segment of a path", () => {
    expect(resolveProjectTarget("nested/dir/my-bot/", cwd)).toEqual({
      packageName: "my-bot",
      targetDir: resolve(cwd, "nested/dir/my-bot"),
    });
    expect(resolveProjectTarget("nested\\my-bot", cwd).packageName).toBe("my-bot");
  });

  test("keeps the scope in the name but not the directory", () => {
    expect(resolveProjectTarget("@acme/my-bot", cwd)).toEqual({
      packageName: "@acme/my-bot",
      targetDir: resolve(cwd, "my-bot"),
    });
  });

  test("treats an empty value as an invalid name", () => {
    expect(validatePackageName(resolveProjectTarget("  ", cwd).packageName)).toBeString();
  });
});

describe("package manager helpers", () => {
  test("detect from the user agent", () => {
    expect(detectPackageManager("bun/1.4.4 npm/? node/v24 win32 x64")).toBe("bun");
    expect(detectPackageManager("npm/11.0.0 node/v22.12.0 linux x64")).toBe("npm");
    expect(detectPackageManager("pnpm/10.0.0 npm/? node/v22 linux x64")).toBe("pnpm");
    expect(detectPackageManager("yarn/4.0.0 npm/? node/v22 linux x64")).toBe("yarn");
    expect(detectPackageManager("something-else/1.0.0")).toBe("bun");
    expect(detectPackageManager(undefined)).toBe("bun");
  });

  test("build commands", () => {
    expect(installCommand("yarn")).toBe("yarn install");
    expect(runScriptCommand("bun", "dev")).toBe("bun run dev");
    expect(runScriptCommand("npm", "dev")).toBe("npm run dev");
    expect(runScriptCommand("pnpm", "dev")).toBe("pnpm dev");
    expect(runScriptCommand("yarn", "dev")).toBe("yarn dev");
  });
});

describe("resolveOptions without prompts", () => {
  function context(cwd: string, userAgent?: string) {
    return { cwd, userAgent, interactive: false, prompter: neverPrompt() };
  }

  test("--yes applies the documented defaults", async () => {
    const cwd = nextDir();
    const options = await resolveOptions(parse("my-bot", "--yes"), { ...context(cwd), interactive: true });
    expect(options).toEqual({
      projectName: "my-bot",
      targetDir: join(cwd, "my-bot"),
      database: "none",
      dialect: null,
      eslint: true,
      packageManager: "bun",
      git: true,
      install: true,
      overwrite: false,
    });
  });

  test("no TTY never prompts and uses a default directory", async () => {
    const cwd = nextDir();
    const options = await resolveOptions(parse(), context(cwd, "pnpm/10.0.0 node/v22"));
    expect(options.projectName).toBe("my-neocord-bot");
    expect(options.packageManager).toBe("pnpm");
  });

  test("flags win over defaults", async () => {
    const options = await resolveOptions(
      parse("x", "--db", "prisma", "--dialect", "postgres", "--no-eslint", "--no-git", "--no-install", "--pm", "npm"),
      context(nextDir()),
    );
    expect(options).toMatchObject({
      database: "prisma",
      dialect: "postgres",
      eslint: false,
      git: false,
      install: false,
      packageManager: "npm",
    });
  });

  test("a database without a dialect defaults to sqlite", async () => {
    const options = await resolveOptions(parse("x", "--db", "drizzle"), context(nextDir()));
    expect(options.dialect).toBe("sqlite");
  });

  test("rejects a dialect that has no database", async () => {
    await expect(resolveOptions(parse("x", "--dialect", "mysql"), context(nextDir()))).rejects.toThrow(CliError);
    await expect(resolveOptions(parse("x", "--db", "none", "--dialect", "mysql"), context(nextDir()))).rejects.toThrow(
      "--dialect cannot be used with --db none",
    );
  });

  test("rejects an invalid project name", async () => {
    await expect(resolveOptions(parse("Bad Name"), context(nextDir()))).rejects.toThrow('Invalid project name "Bad Name"');
  });

  test("a dot uses the cwd name and validates it", async () => {
    const cwd = join(nextDir(), "valid-name");
    mkdirSync(cwd);
    expect((await resolveOptions(parse("."), context(cwd))).projectName).toBe("valid-name");

    const invalid = join(nextDir(), "Invalid Name");
    mkdirSync(invalid);
    await expect(resolveOptions(parse("."), context(invalid))).rejects.toThrow(CliError);
  });

  test("refuses a non-empty directory unless forced", async () => {
    const cwd = nextDir();
    mkdirSync(join(cwd, "taken"));
    writeFileSync(join(cwd, "taken", "file.txt"), "x");
    await expect(resolveOptions(parse("taken"), context(cwd))).rejects.toThrow("--force");
    expect((await resolveOptions(parse("taken", "--force"), context(cwd))).overwrite).toBe(true);
  });

  test("refuses a path that is a file, even when forced", async () => {
    const cwd = nextDir();
    writeFileSync(join(cwd, "file"), "x");
    await expect(resolveOptions(parse("file", "--force"), context(cwd))).rejects.toThrow("not a directory");
  });
});

describe("resolveOptions with prompts", () => {
  const answers = {
    "Where should": "prompted-bot",
    "database toolkit": "prisma",
    "Which database will": "mysql",
    ESLint: false,
    "package manager": "yarn",
    git: false,
    "Install dependencies": false,
  };

  function context(cwd: string, prompter: Prompter) {
    return { cwd, userAgent: undefined, interactive: true, prompter };
  }

  test("collects every answer", async () => {
    const cwd = nextDir();
    const options = await resolveOptions(parse(), context(cwd, scriptedPrompter(answers)));
    expect(options).toEqual({
      projectName: "prompted-bot",
      targetDir: join(cwd, "prompted-bot"),
      database: "prisma",
      dialect: "mysql",
      eslint: false,
      packageManager: "yarn",
      git: false,
      install: false,
      overwrite: false,
    });
  });

  test("does not ask about values given as flags", async () => {
    const options = await resolveOptions(
      parse("x", "--db", "none", "--eslint", "--git", "--install", "--pm", "bun"),
      context(nextDir(), neverPrompt()),
    );
    expect(options.database).toBe("none");
    expect(options.dialect).toBeNull();
  });

  test("a cancelled prompt raises CancelledError", async () => {
    await expect(
      resolveOptions(parse(), context(nextDir(), scriptedPrompter({ ...answers, "database toolkit": CANCEL_SYMBOL }))),
    ).rejects.toThrow(CancelledError);
  });

  test("asks before using a non-empty directory", async () => {
    const cwd = nextDir();
    mkdirSync(join(cwd, "taken"));
    writeFileSync(join(cwd, "taken", "file.txt"), "x");

    const declined = scriptedPrompter({ ...answers, "is not empty": false });
    await expect(resolveOptions(parse("taken"), context(cwd, declined))).rejects.toThrow(CancelledError);

    const accepted = scriptedPrompter({ ...answers, "is not empty": true });
    expect((await resolveOptions(parse("taken"), context(cwd, accepted))).overwrite).toBe(true);
  });
});

describe("nextSteps", () => {
  const options = {
    projectName: "x",
    targetDir: resolve(tmpdir(), "x"),
    database: "drizzle",
    dialect: "sqlite",
    eslint: true,
    packageManager: "pnpm",
    git: false,
    install: false,
    overwrite: false,
  } as const;

  test("lists install and database steps when they are still needed", () => {
    expect(nextSteps(options, { targetDir: options.targetDir, install: "skipped", git: { status: "skipped" } }, tmpdir())).toEqual([
      "cd x",
      "pnpm install",
      "Copy .env.example to .env and set DISCORD_TOKEN",
      "pnpm db:push",
      "pnpm dev",
    ]);
  });

  test("omits cd and install when they are done", () => {
    const steps = nextSteps(
      { ...options, database: "none", dialect: null },
      { targetDir: options.targetDir, install: "succeeded", git: { status: "skipped" } },
      options.targetDir,
    );
    expect(steps).toEqual(["Copy .env.example to .env and set DISCORD_TOKEN", "pnpm dev"]);
  });
});

describe("main", () => {
  function dependencies(cwd: string, logger = capturingLogger()) {
    return { cwd, env: {}, interactive: false, prompter: neverPrompt(), logger, output: silent };
  }

  test("scaffolds a project end to end and prints next steps", async () => {
    const cwd = nextDir();
    const logger = capturingLogger();
    const code = await main(["my-bot", "--yes", "--no-install", "--no-git", "--db", "drizzle"], dependencies(cwd, logger));
    expect(code).toBe(0);
    expect(existsSync(join(cwd, "my-bot", "drizzle.config.ts"))).toBe(true);
    expect(JSON.parse(readFileSync(join(cwd, "my-bot", "package.json"), "utf8")).name).toBe("my-bot");
    expect(logger.messages.join("\n")).toContain("bun run db:push");
  });

  test("returns non-zero for invalid flags without creating anything", async () => {
    const cwd = nextDir();
    expect(await main(["x", "--db", "mongo"], dependencies(cwd))).toBe(1);
    expect(existsSync(join(cwd, "x"))).toBe(false);
  });

  test("returns zero for help and version", async () => {
    const cwd = nextDir();
    expect(await main(["--help"], dependencies(cwd))).toBe(0);
    expect(await main(["--version"], dependencies(cwd))).toBe(0);
  });

  test("returns non-zero and reports a non-empty directory", async () => {
    const cwd = nextDir();
    mkdirSync(join(cwd, "taken"));
    writeFileSync(join(cwd, "taken", "keep.txt"), "keep");
    const logger = capturingLogger();
    expect(await main(["taken", "--yes", "--no-install", "--no-git"], dependencies(cwd, logger))).toBe(1);
    expect(logger.messages.join("\n")).toContain("--force");
    expect(existsSync(join(cwd, "taken", "package.json"))).toBe(false);
  });

  test("--force writes into a non-empty directory", async () => {
    const cwd = nextDir();
    mkdirSync(join(cwd, "taken"));
    writeFileSync(join(cwd, "taken", "keep.txt"), "keep");
    expect(await main(["taken", "--yes", "--force", "--no-install", "--no-git"], dependencies(cwd))).toBe(0);
    expect(existsSync(join(cwd, "taken", "package.json"))).toBe(true);
    expect(existsSync(join(cwd, "taken", "keep.txt"))).toBe(true);
  });

  test("returns zero when the user cancels, leaving nothing behind", async () => {
    const cwd = nextDir();
    const logger = capturingLogger();
    const prompter = scriptedPrompter({ "Where should": CANCEL_SYMBOL });
    expect(await main([], { ...dependencies(cwd, logger), interactive: true, prompter })).toBe(0);
    expect(logger.messages.join("\n")).toContain("Cancelled");
    expect(existsSync(join(cwd, "my-neocord-bot"))).toBe(false);
  });

  test("returns non-zero when the install fails", async () => {
    const cwd = nextDir();
    const logger = capturingLogger();
    const scaffold = mock(async () => ({
      targetDir: join(cwd, "x"),
      install: "failed" as const,
      git: { status: "skipped" as const },
    }));
    expect(await main(["x", "--yes"], { ...dependencies(cwd, logger), scaffold })).toBe(1);
    expect(logger.messages.join("\n")).toContain("Installing dependencies failed");
  });

  test("reports an invalid override variable", async () => {
    const cwd = nextDir();
    const logger = capturingLogger();
    const code = await main(["x", "--yes", "--no-install", "--no-git"], {
      ...dependencies(cwd, logger),
      env: { NEOCORD_TEMPLATE_VERSION_OVERRIDES: "{bad" },
    });
    expect(code).toBe(1);
    expect(logger.messages.join("\n")).toContain("valid JSON");
    expect(basename(cwd)).toStartWith("cwd-");
  });
});

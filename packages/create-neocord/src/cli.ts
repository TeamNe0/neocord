import { readFileSync } from "node:fs";
import { relative } from "node:path";
import * as clack from "@clack/prompts";
import { Command, CommanderError, Option } from "commander";
import {
  type Database,
  DATABASES,
  DEFAULT_DIALECT,
  DEFAULT_PROJECT_NAME,
  type Dialect,
  DIALECTS,
  type ProjectOptions,
} from "./options.ts";
import {
  detectPackageManager,
  installCommand,
  PACKAGE_MANAGERS,
  type PackageManager,
  runScriptCommand,
} from "./package-manager.ts";
import { inspectDirectory, resolveProjectTarget, validatePackageName } from "./project.ts";
import { scaffold, type ScaffoldHooks, type ScaffoldResult } from "./scaffold.ts";

export class CliError extends Error {}
export class CancelledError extends Error {}

export interface CliFlags {
  db?: Database;
  dialect?: Dialect;
  eslint?: boolean;
  git?: boolean;
  install?: boolean;
  pm?: PackageManager;
  yes: boolean;
  force: boolean;
}

export interface ParsedArgs {
  dir?: string;
  flags: CliFlags;
}

interface CommanderOptions {
  db?: Database;
  dialect?: Dialect;
  eslint?: boolean;
  git?: boolean;
  install?: boolean;
  pm?: PackageManager;
  yes?: boolean;
  force?: boolean;
}

export interface OutputWriters {
  writeOut?: (text: string) => void;
  writeErr?: (text: string) => void;
}

function readPackageVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  if (typeof manifest === "object" && manifest !== null && "version" in manifest && typeof manifest.version === "string") {
    return manifest.version;
  }
  throw new Error("create-neocord could not read its own version.");
}

export function createProgram(output: OutputWriters = {}): Command {
  const program = new Command()
    .name("create-neocord")
    .description("Scaffold a type-safe neocord Discord bot.")
    .version(readPackageVersion(), "-v, --version", "print the version")
    .helpOption("-h, --help", "show this help")
    .argument("[dir]", 'project directory, or "." for the current directory')
    .addOption(new Option("--db <orm>", "database toolkit").choices(DATABASES))
    .addOption(new Option("--dialect <dialect>", "database dialect").choices(DIALECTS))
    .option("--eslint", "add ESLint with the neocord rules")
    .option("--no-eslint", "skip ESLint")
    .option("--git", "initialize a git repository")
    .option("--no-git", "skip git")
    .option("--install", "install dependencies")
    .option("--no-install", "skip installing dependencies")
    .addOption(new Option("--pm <manager>", "package manager, detected from how this was launched").choices(PACKAGE_MANAGERS))
    .option("-y, --yes", "accept defaults and never prompt")
    .option("--force", "allow scaffolding into a non-empty directory, overwriting matching files")
    .exitOverride();

  if (output.writeOut || output.writeErr) {
    program.configureOutput({
      ...(output.writeOut ? { writeOut: output.writeOut } : {}),
      ...(output.writeErr ? { writeErr: output.writeErr } : {}),
    });
  }
  return program;
}

export function parseArgs(args: readonly string[], output: OutputWriters = {}): ParsedArgs {
  const program = createProgram(output);
  program.parse([...args], { from: "user" });

  const options = program.opts<CommanderOptions>();
  const flags: CliFlags = { yes: options.yes === true, force: options.force === true };
  if (options.db !== undefined) flags.db = options.db;
  if (options.dialect !== undefined) flags.dialect = options.dialect;
  if (options.eslint !== undefined) flags.eslint = options.eslint;
  if (options.git !== undefined) flags.git = options.git;
  if (options.install !== undefined) flags.install = options.install;
  if (options.pm !== undefined) flags.pm = options.pm;

  const dir = program.args[0];
  return dir === undefined ? { flags } : { dir, flags };
}

export interface SelectChoice<Value extends string> {
  value: Value;
  label: string;
  hint?: string;
}

export interface Prompter {
  text(options: {
    message: string;
    placeholder: string;
    defaultValue: string;
    validate: (value: string) => string | undefined;
  }): Promise<string | symbol>;
  select<Value extends string>(options: {
    message: string;
    choices: SelectChoice<Value>[];
    initialValue: Value;
  }): Promise<Value | symbol>;
  confirm(options: { message: string; initialValue: boolean }): Promise<boolean | symbol>;
}

export const clackPrompter: Prompter = {
  text: ({ message, placeholder, defaultValue, validate }) =>
    clack.text({ message, placeholder, defaultValue, validate: (value) => validate(value || defaultValue) }),
  select: <Value extends string>({
    message,
    choices,
    initialValue,
  }: {
    message: string;
    choices: SelectChoice<Value>[];
    initialValue: Value;
  }) =>
    clack.select<string>({
      message,
      initialValue,
      options: choices.map((choice) => ({
        value: choice.value,
        label: choice.label,
        ...(choice.hint ? { hint: choice.hint } : {}),
      })),
    }) as Promise<Value | symbol>,
  confirm: (options) => clack.confirm(options),
};

function answered<Value>(value: Value | symbol): Value {
  if (clack.isCancel(value)) throw new CancelledError();
  return value as Value;
}

export interface ResolveContext {
  cwd: string;
  userAgent: string | undefined;
  interactive: boolean;
  prompter: Prompter;
}

function validateCombination({ flags }: ParsedArgs): void {
  if (flags.dialect && flags.db === "none") {
    throw new CliError("--dialect cannot be used with --db none.");
  }
}

async function chooseDatabase(flags: CliFlags, prompts: Prompter | null): Promise<Database> {
  if (flags.db) return flags.db;
  if (!prompts) {
    if (flags.dialect) throw new CliError("--dialect needs --db drizzle or --db prisma when running without prompts.");
    return "none";
  }

  const toolkits: SelectChoice<Database>[] = [
    { value: "drizzle", label: "Drizzle", hint: "drizzle-orm and drizzle-kit" },
    { value: "prisma", label: "Prisma", hint: "Prisma 7 with a driver adapter" },
  ];
  return answered(
    await prompts.select<Database>({
      message: "Which database toolkit do you want?",
      choices: flags.dialect ? toolkits : [{ value: "none", label: "None" }, ...toolkits],
      initialValue: flags.dialect ? "drizzle" : "none",
    }),
  );
}

async function chooseDialect(database: Database, flags: CliFlags, prompts: Prompter | null): Promise<Dialect | null> {
  if (database === "none") return null;
  if (flags.dialect) return flags.dialect;
  if (!prompts) return DEFAULT_DIALECT;
  return answered(
    await prompts.select<Dialect>({
      message: "Which database will you use?",
      choices: [
        { value: "sqlite", label: "SQLite", hint: "libsql, no native builds" },
        { value: "postgres", label: "PostgreSQL" },
        { value: "mysql", label: "MySQL" },
      ],
      initialValue: DEFAULT_DIALECT,
    }),
  );
}

async function chooseBoolean(
  flag: boolean | undefined,
  message: string,
  prompts: Prompter | null,
): Promise<boolean> {
  if (flag !== undefined) return flag;
  if (!prompts) return true;
  return answered(await prompts.confirm({ message, initialValue: true }));
}

async function checkTargetDirectory(targetDir: string, flags: CliFlags, prompts: Prompter | null): Promise<boolean> {
  const state = await inspectDirectory(targetDir);
  if (state === "not-a-directory") throw new CliError(`${targetDir} exists and is not a directory.`);
  if (state !== "non-empty") return false;
  if (flags.force) return true;
  if (!prompts) {
    throw new CliError(`${targetDir} is not empty. Pass --force to scaffold into it anyway.`);
  }
  const proceed = answered(
    await prompts.confirm({
      message: `${targetDir} is not empty. Continue and overwrite files that have the same name?`,
      initialValue: false,
    }),
  );
  if (!proceed) throw new CancelledError();
  return true;
}

export async function resolveOptions(parsed: ParsedArgs, context: ResolveContext): Promise<ProjectOptions> {
  validateCombination(parsed);

  const { flags } = parsed;
  const prompts = context.interactive && !flags.yes ? context.prompter : null;

  const dir =
    parsed.dir ??
    (prompts
      ? answered(
          await prompts.text({
            message: "Where should the project be created?",
            placeholder: DEFAULT_PROJECT_NAME,
            defaultValue: DEFAULT_PROJECT_NAME,
            validate: (value) => validatePackageName(resolveProjectTarget(value, context.cwd).packageName),
          }),
        )
      : DEFAULT_PROJECT_NAME);

  const { packageName, targetDir } = resolveProjectTarget(dir, context.cwd);
  const invalidName = validatePackageName(packageName);
  if (invalidName) throw new CliError(`Invalid project name "${packageName}": ${invalidName}`);

  const overwrite = await checkTargetDirectory(targetDir, flags, prompts);
  const database = await chooseDatabase(flags, prompts);
  const dialect = await chooseDialect(database, flags, prompts);
  const eslint = await chooseBoolean(flags.eslint, "Add ESLint with the neocord rules?", prompts);

  const detected = detectPackageManager(context.userAgent);
  const packageManager =
    flags.pm ??
    (prompts
      ? answered(
          await prompts.select<PackageManager>({
            message: "Which package manager do you want to use?",
            choices: PACKAGE_MANAGERS.map((value) => ({ value, label: value })),
            initialValue: detected,
          }),
        )
      : detected);

  const git = await chooseBoolean(flags.git, "Initialize a git repository?", prompts);
  const install = await chooseBoolean(flags.install, `Install dependencies with ${packageManager}?`, prompts);

  return {
    projectName: packageName,
    targetDir,
    database,
    dialect,
    eslint,
    packageManager,
    git,
    install,
    overwrite,
  };
}

export function nextSteps(options: ProjectOptions, result: ScaffoldResult, cwd: string): string[] {
  const steps: string[] = [];
  const location = relative(cwd, options.targetDir);
  if (location) steps.push(`cd ${location.includes(" ") ? `"${location}"` : location}`);
  if (result.install !== "succeeded") steps.push(installCommand(options.packageManager));
  steps.push("Copy .env.example to .env and set DISCORD_TOKEN");
  if (options.database !== "none") steps.push(runScriptCommand(options.packageManager, "db:push"));
  steps.push(runScriptCommand(options.packageManager, "dev"));
  return steps;
}

export interface CliLogger {
  intro(message: string): void;
  step(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  note(message: string, title: string): void;
  outro(message: string): void;
  cancel(message: string): void;
}

const clackLogger: CliLogger = {
  intro: (message) => clack.intro(message),
  step: (message) => clack.log.step(message),
  warn: (message) => clack.log.warn(message),
  error: (message) => clack.log.error(message),
  note: (message, title) => clack.note(message, title),
  outro: (message) => clack.outro(message),
  cancel: (message) => clack.cancel(message),
};

export interface CliDependencies {
  cwd: string;
  env: NodeJS.ProcessEnv;
  interactive: boolean;
  prompter: Prompter;
  logger: CliLogger;
  output: OutputWriters;
  scaffold: (options: ProjectOptions, hooks: ScaffoldHooks) => Promise<ScaffoldResult>;
}

function reportResult(result: ScaffoldResult, logger: CliLogger): boolean {
  if (result.git.status === "failed") logger.warn("Could not initialize git. You can run git init yourself.");
  if (result.git.status === "existing-repository") logger.step("Skipped git init because this is already inside a repository.");
  if (result.git.status === "initialized" && !result.git.committed) {
    logger.warn("Initialized git and staged the files, but could not create the first commit. Check your git identity.");
  }
  if (result.install === "failed") {
    logger.error("Installing dependencies failed. The project files are in place, so you can retry the install yourself.");
    return false;
  }
  return true;
}

export async function main(argv: readonly string[], overrides: Partial<CliDependencies> = {}): Promise<number> {
  const dependencies: CliDependencies = {
    cwd: process.cwd(),
    env: process.env,
    interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
    prompter: clackPrompter,
    logger: clackLogger,
    output: {},
    scaffold,
    ...overrides,
  };
  const { cwd, env, interactive, logger, output, prompter } = dependencies;

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv, output);
  } catch (error) {
    if (error instanceof CommanderError) return error.exitCode;
    throw error;
  }

  try {
    logger.intro("create-neocord");
    const options = await resolveOptions(parsed, { cwd, userAgent: env.npm_config_user_agent, interactive, prompter });
    const result = await dependencies.scaffold(options, { env, onStep: logger.step });
    const succeeded = reportResult(result, logger);
    logger.note(nextSteps(options, result, cwd).join("\n"), "Next steps");
    logger.outro(succeeded ? `Created ${options.projectName}.` : `Created ${options.projectName} with errors.`);
    return succeeded ? 0 : 1;
  } catch (error) {
    if (error instanceof CancelledError) {
      logger.cancel("Cancelled. Nothing was created.");
      return 0;
    }
    logger.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

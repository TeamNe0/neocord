import { readFileSync } from "node:fs";
import { Command, CommanderError, InvalidArgumentError } from "commander";
import { runBuild } from "./commands/build.ts";
import { runDeploy } from "./commands/deploy.ts";
import { runDev } from "./commands/dev.ts";
import { runInfo } from "./commands/info.ts";
import { runLint } from "./commands/lint.ts";
import { runRoutes } from "./commands/routes.ts";
import { runStart } from "./commands/start.ts";
import { runTest } from "./commands/test.ts";
import { runTypegen } from "./commands/typegen.ts";
import { CliError } from "./errors.ts";
import { Ui, type UiOptions } from "./ui.ts";

function readCliVersion(): string {
  const manifest: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const version = typeof manifest === "object" && manifest !== null ? (manifest as { version?: unknown }).version : undefined;
  return typeof version === "string" ? version : "0.0.0";
}

function parseShards(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new InvalidArgumentError("Expected a positive integer.");
  }
  return parsed;
}

export function createProgram(ui: Ui, setExitCode: (code: number) => void): Command {
  const version = readCliVersion();
  const program = new Command();

  const cwdOf = (): string | undefined => program.opts<{ cwd?: string }>().cwd;
  const finish = async (run: Promise<number>): Promise<void> => {
    setExitCode(await run);
  };

  program
    .name("neocord")
    .description("Develop, build, launch, deploy and test neocord Discord bots.")
    .version(version, "-v, --version", "print the CLI version")
    .helpOption("-h, --help", "show help")
    .option("--cwd <dir>", "run as if started in this directory")
    .showHelpAfterError("(run with --help for usage)")
    .exitOverride()
    .configureOutput({
      writeOut: (text) => ui.stdout.write(text),
      writeErr: (text) => ui.stderr.write(text),
    });

  program
    .command("dev")
    .description("generate, bundle and run the bot, restarting on change")
    .option("--shards <n>", "run through the sharding manager with n shards", parseShards)
    .option("--no-deploy", "do not sync commands to dev.guildId")
    .action(async (options: { shards?: number; deploy: boolean }) => {
      await finish(runDev({ cwd: cwdOf(), shards: options.shards, deploy: options.deploy }, ui));
    });

  program
    .command("build")
    .description("create the production bundle in .neocord/build")
    .option("--no-validate", "skip validating routes and command payloads")
    .option("--typecheck", "run tsc --noEmit before bundling")
    .action(async (options: { validate: boolean; typecheck?: boolean }) => {
      await finish(runBuild({ cwd: cwdOf(), validate: options.validate, typecheck: options.typecheck === true }, ui));
    });

  program
    .command("start")
    .description("launch the sharding manager from the production bundle")
    .option("--shards <n>", "total shard count", parseShards)
    .option("--deploy", "deploy commands before starting")
    .action(async (options: { shards?: number; deploy?: boolean }) => {
      await finish(runStart({ cwd: cwdOf(), shards: options.shards, deploy: options.deploy === true }, ui));
    });

  program
    .command("deploy")
    .description("register commands with Discord, skipping when nothing changed")
    .option("--guild <id>", "deploy to one guild instead of globally")
    .option("--force", "deploy even when the command hash is unchanged")
    .option("--dry-run", "print what would be deployed without calling Discord")
    .option("--clear", "remove every command from the guild or global scope")
    .action(async (options: { guild?: string; force?: boolean; dryRun?: boolean; clear?: boolean }) => {
      await finish(
        runDeploy(
          {
            cwd: cwdOf(),
            guild: options.guild,
            force: options.force === true,
            dryRun: options.dryRun === true,
            clear: options.clear === true,
          },
          ui,
        ),
      );
    });

  program
    .command("test")
    .description("validate routes and command payloads, then run the project's tests")
    .argument("[files...]", "test files or filters, forwarded to the runner")
    .option("--watch", "re-run tests on change")
    .option("--coverage", "collect coverage")
    .option("--no-validate", "skip route and command validation")
    .option("--validate-only", "validate without running tests")
    .allowUnknownOption()
    .action(async (files: string[], options: { watch?: boolean; coverage?: boolean; validate: boolean; validateOnly?: boolean }) => {
      await finish(
        runTest(
          {
            cwd: cwdOf(),
            files,
            watch: options.watch === true,
            coverage: options.coverage === true,
            validate: options.validate,
            validateOnly: options.validateOnly === true,
          },
          ui,
        ),
      );
    });

  program
    .command("typegen")
    .description("write .neocord/manifest.ts and .neocord/types.d.ts")
    .action(async () => {
      await finish(runTypegen({ cwd: cwdOf() }, ui));
    });

  program
    .command("routes")
    .description("print the route table")
    .option("--json", "print machine-readable JSON")
    .action(async (options: { json?: boolean }) => {
      await finish(runRoutes({ cwd: cwdOf(), json: options.json === true }, ui));
    });

  program
    .command("lint")
    .description("run the project's ESLint")
    .option("--fix", "apply automatic fixes")
    .action(async (options: { fix?: boolean }) => {
      await finish(runLint({ cwd: cwdOf(), fix: options.fix === true }));
    });

  program
    .command("info")
    .description("print versions and environment for bug reports")
    .action(async () => {
      await finish(runInfo({ cwd: cwdOf(), cliVersion: version }, ui));
    });

  return program;
}

export interface MainOptions extends UiOptions {
  argv?: readonly string[];
}

export async function main(options: MainOptions = {}): Promise<number> {
  const ui = new Ui(options);
  let exitCode = 0;
  const program = createProgram(ui, (code) => {
    exitCode = code;
  });
  try {
    await program.parseAsync([...(options.argv ?? process.argv)]);
  } catch (error) {
    if (error instanceof CommanderError) {
      exitCode = error.exitCode;
    } else {
      ui.reportError(error);
      exitCode = error instanceof CliError ? error.exitCode : 1;
    }
  }
  process.exitCode = exitCode;
  return exitCode;
}

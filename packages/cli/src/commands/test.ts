import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { CliError } from "../errors.ts";
import { assertNoIssues, openProject, runValidation, syncProject } from "../project/pipeline.ts";
import { findBun, projectDependsOn, resolvePackageBin, resolveToolRunner } from "../project/runtime.ts";
import { runProcess } from "../project/spawn.ts";
import type { Ui } from "../ui.ts";

export interface TestCommandOptions {
  cwd?: string | undefined;
  files: string[];
  watch: boolean;
  coverage: boolean;
  validate: boolean;
  validateOnly: boolean;
}

export type TestRunner =
  | { kind: "vitest"; bin: string }
  | { kind: "bun"; command: string };

export interface SelectRunnerContext {
  findBun?: () => string | null;
}

const TEST_FILE = /[._](test|spec)\.[cm]?[jt]sx?$/;
const SKIPPED_DIRECTORIES = new Set(["node_modules", "dist", "build", "coverage"]);

export function selectTestRunner(root: string, context: SelectRunnerContext = {}): TestRunner {
  if (projectDependsOn(root, "vitest")) {
    const bin = resolvePackageBin(root, "vitest");
    if (bin === null) {
      throw new CliError("vitest is listed in package.json but is not installed.", {
        hint: "Install your dependencies, then run neocord test again.",
      });
    }
    return { kind: "vitest", bin };
  }
  const bun = (context.findBun ?? findBun)();
  if (bun !== null) return { kind: "bun", command: bun };
  throw new CliError("No test runner found.", {
    hint: "Install bun from https://bun.com/docs/installation, or add vitest with: npm install -D vitest",
  });
}

async function containsTestFile(directory: string): Promise<boolean> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (entry.name.startsWith(".") || SKIPPED_DIRECTORIES.has(entry.name)) continue;
      if (await containsTestFile(join(directory, entry.name))) return true;
    } else if (TEST_FILE.test(entry.name)) {
      return true;
    }
  }
  return false;
}

export function runnerCommand(runner: TestRunner, options: TestCommandOptions): { command: string; args: string[] } {
  if (runner.kind === "vitest") {
    return {
      command: resolveToolRunner(),
      args: [
        runner.bin,
        options.watch ? "watch" : "run",
        "--passWithNoTests",
        ...(options.coverage ? ["--coverage"] : []),
        ...options.files,
      ],
    };
  }
  return {
    command: runner.command,
    args: [
      "--no-env-file",
      "test",
      ...(options.watch ? ["--watch"] : []),
      ...(options.coverage ? ["--coverage"] : []),
      ...options.files,
    ],
  };
}

export async function runTest(options: TestCommandOptions, ui: Ui): Promise<number> {
  if (!options.validate && options.validateOnly) {
    throw new CliError("--no-validate and --validate-only cannot be used together.");
  }

  const project = await openProject({ cwd: options.cwd, mode: "test", skipEnvValidation: true });
  const { scan } = await syncProject(project);
  assertNoIssues(scan);

  if (options.validate) {
    const outcome = await runValidation(project, ui);
    ui.success(`Validated ${scan.routes.length} routes and ${outcome.commandCount} commands.`);
  }
  if (options.validateOnly) return 0;

  const runner = selectTestRunner(project.root);
  if (runner.kind === "bun" && options.files.length === 0 && !(await containsTestFile(project.root))) {
    ui.success("No tests found.");
    return 0;
  }

  const { command, args } = runnerCommand(runner, options);
  const { code } = await runProcess({ command, args, cwd: project.root, env: project.env });
  return code;
}

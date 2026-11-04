import { readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { build, type Plugin } from "esbuild";
import { CliError } from "../errors.ts";
import { compareStrings, relativePosix, toPosix } from "../project/paths.ts";
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
const VITEST_TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const VITEST_EXCLUDED_DIRECTORIES = new Set(["node_modules", ".git"]);
const UNCOLLECTED_RUNNERS = new Set(["node:test", "bun:test"]);

const KEEP_IMPORTS_EXTERNAL: Plugin = {
  name: "keep-imports-external",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /.*/ }, (args) =>
      args.kind === "entry-point" ? undefined : { path: args.path, external: true },
    );
  },
};

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

async function listVitestFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return VITEST_EXCLUDED_DIRECTORIES.has(entry.name) ? [] : listVitestFiles(path);
      return VITEST_TEST_FILE.test(entry.name) ? [path] : [];
    }),
  );
  return files.flat();
}

function vitestFilters(args: readonly string[]): string[] {
  const filters: string[] = [];
  let mayBeFlagValue = false;
  for (const arg of args) {
    if (arg.startsWith("-")) {
      mayBeFlagValue = !arg.includes("=");
      continue;
    }
    if (!mayBeFlagValue) filters.push(arg.replace(/:\d+$/, ""));
    mayBeFlagValue = false;
  }
  return filters;
}

function matchesVitestFilter(root: string, file: string, filter: string): boolean {
  const testFile = relativePosix(root, file).toLowerCase();
  const fromRoot = relativePosix(root, resolve(root, filter)).toLowerCase();
  return testFile.includes(toPosix(filter).toLowerCase()) || testFile.includes(fromRoot);
}

async function selectVitestFiles(root: string, args: readonly string[]): Promise<string[]> {
  const included = await listVitestFiles(root);
  const filters = vitestFilters(args);
  if (filters.length === 0) return included;
  const explicit = await Promise.all(
    filters.map((filter) =>
      stat(resolve(root, filter)).then(
        (info) => (info.isFile() ? [resolve(root, filter)] : []),
        () => [],
      ),
    ),
  );
  const matching = included.filter((file) => filters.some((filter) => matchesVitestFilter(root, file, filter)));
  return [...new Set([...matching, ...explicit.flat()])];
}

async function uncollectedImports(root: string, file: string): Promise<string[]> {
  try {
    const { metafile } = await build({
      absWorkingDir: root,
      entryPoints: [file],
      bundle: true,
      write: false,
      metafile: true,
      format: "esm",
      platform: "node",
      logLevel: "silent",
      tsconfigRaw: "{}",
      plugins: [KEEP_IMPORTS_EXTERNAL],
    });
    const imports = Object.values(metafile.inputs).flatMap((input) => input.imports.map((item) => item.path));
    return [...new Set(imports.filter((path) => UNCOLLECTED_RUNNERS.has(path)))];
  } catch {
    return [];
  }
}

export async function assertVitestCollectsTests(root: string, args: readonly string[]): Promise<void> {
  const files = await selectVitestFiles(root, args);
  const found = await Promise.all(
    files.map(async (file) => {
      const name = relativePosix(root, file);
      return (await uncollectedImports(root, file)).map((runner) => `${name} imports ${runner}`);
    }),
  );
  const details = found.flat().sort(compareStrings);
  if (details.length === 0) return;
  throw new CliError(
    "vitest does not collect tests from node:test or bun:test, so these files would pass even with failing assertions.",
    { details, hint: 'Import test and expect from "vitest" in these files, then run neocord test again.' },
  );
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
  if (runner.kind === "vitest") await assertVitestCollectsTests(project.root, options.files);

  const { command, args } = runnerCommand(runner, options);
  const { code } = await runProcess({ command, args, cwd: project.root, env: project.env });
  return code;
}

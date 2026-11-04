import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type GitResult, initGit } from "./git.ts";
import { buildInstallers, type InstallerContext, type PackageJsonDraft } from "./installers/index.ts";
import type { ProjectOptions } from "./options.ts";
import { installCommand, runInstall, runScriptCommand } from "./package-manager.ts";
import { inspectDirectory, validatePackageName } from "./project.ts";
import { parseVersionOverrides } from "./versions.ts";

export const TEMPLATE_DIR = fileURLToPath(new URL("../template", import.meta.url));

export type InstallResult = "skipped" | "succeeded" | "failed";

export interface ScaffoldResult {
  targetDir: string;
  install: InstallResult;
  git: GitResult;
}

export interface ScaffoldHooks {
  env?: NodeJS.ProcessEnv;
  templateDir?: string;
  onStep?: (message: string) => void;
}

function sortRecord(record: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function scriptRows(options: ProjectOptions): string {
  const run = (script: string) => `\`${runScriptCommand(options.packageManager, script)}\``;
  const rows = [
    [run("dev"), "Run the bot in development, restart on change, and sync commands to `DEV_GUILD_ID`."],
    [run("build"), "Create the production bundle in `.neocord/build`."],
    [run("start"), "Run the production bundle."],
    [run("deploy"), "Register slash commands with Discord."],
    [run("test"), "Validate every route and run the tests."],
    [run("typecheck"), "Generate route types and run `tsc`."],
  ];
  if (options.eslint) rows.push([run("lint"), "Run ESLint."]);
  return ["| Command | What it does |", "| --- | --- |", ...rows.map(([command, text]) => `| ${command} | ${text} |`)].join("\n");
}

function databaseSection(context: InstallerContext): string {
  if (context.options.database === "none") return "";
  const { packageManager } = context.options;
  const run = (script: string) => `\`${runScriptCommand(packageManager, script)}\``;
  return [
    "## Database",
    "",
    context.databaseReadme,
    "",
    `Set \`DATABASE_URL\` in \`.env\`, then run ${run("db:push")} to create the tables. The \`/remember\` command in \`src/features/general/commands/remember\` shows how handlers read \`ctx.app.db\`.`,
    "",
    "| Command | What it does |",
    "| --- | --- |",
    `| ${run("db:push")} | Apply the schema directly, which suits development. |`,
    `| ${run("db:generate")} | ${context.options.database === "prisma" ? "Generate the Prisma client." : "Generate a SQL migration from the schema."} |`,
    `| ${run("db:migrate")} | ${context.options.database === "prisma" ? "Create and apply a migration." : "Apply pending migrations."} |`,
    ...(context.options.database === "prisma"
      ? [`| ${run("db:deploy")} | Apply committed migrations in production. |`]
      : []),
    `| ${run("db:studio")} | Browse the data in a local UI. |`,
    "",
    "",
  ].join("\n");
}

async function renderReadme(context: InstallerContext): Promise<void> {
  const { packageManager, projectName, targetDir } = context.options;
  const path = join(targetDir, "README.md");
  const replacements: Record<string, string> = {
    projectName,
    imageName: projectName.replace(/^@/, ""),
    install: installCommand(packageManager),
    dev: runScriptCommand(packageManager, "dev"),
    scripts: scriptRows(context.options),
    database: databaseSection(context),
  };
  const template = await readFile(path, "utf8");
  const rendered = template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => replacements[key] ?? match);
  await writeFile(path, rendered);
}

async function finalizeGitignore(targetDir: string): Promise<void> {
  const destination = join(targetDir, ".gitignore");
  await rm(destination, { force: true });
  await rename(join(targetDir, "_gitignore"), destination);
}

async function writePackageJson(context: InstallerContext): Promise<void> {
  const { packageJson } = context;
  const sorted: PackageJsonDraft = {
    ...packageJson,
    dependencies: sortRecord(packageJson.dependencies),
    devDependencies: sortRecord(packageJson.devDependencies),
  };
  await writeFile(join(context.options.targetDir, "package.json"), `${JSON.stringify(sorted, null, 2)}\n`);
}

function validateOptions(options: ProjectOptions): void {
  const invalidName = validatePackageName(options.projectName);
  if (invalidName) throw new Error(invalidName);
  if (options.database !== "none" && !options.dialect) {
    throw new Error(`The ${options.database} database needs a dialect.`);
  }
  if (options.database === "none" && options.dialect) {
    throw new Error("A dialect can only be used with a database.");
  }
}

export async function scaffold(options: ProjectOptions, hooks: ScaffoldHooks = {}): Promise<ScaffoldResult> {
  validateOptions(options);

  const state = await inspectDirectory(options.targetDir);
  if (state === "not-a-directory") throw new Error(`${options.targetDir} exists and is not a directory.`);
  if (state === "non-empty" && !options.overwrite) {
    throw new Error(`${options.targetDir} is not empty. Pass --force to scaffold into it anyway.`);
  }

  const context: InstallerContext = {
    options,
    templateDir: hooks.templateDir ?? TEMPLATE_DIR,
    versionOverrides: parseVersionOverrides(hooks.env ?? process.env),
    databaseReadme: "",
    packageJson: {
      name: options.projectName,
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {},
      dependencies: {},
      devDependencies: {},
      engines: { node: ">=22.22.0" },
    },
  };

  await mkdir(options.targetDir, { recursive: true });

  for (const installer of buildInstallers(options)) {
    if (!installer.inUse) continue;
    hooks.onStep?.(`Adding ${installer.name} files`);
    await installer.install(context);
  }

  await finalizeGitignore(options.targetDir);
  await renderReadme(context);
  await writePackageJson(context);

  let install: InstallResult = "skipped";
  if (options.install) {
    hooks.onStep?.(`Installing dependencies with ${options.packageManager}`);
    install = (await runInstall(options.packageManager, options.targetDir)) ? "succeeded" : "failed";
  }

  let git: GitResult = { status: "skipped" };
  if (options.git) {
    hooks.onStep?.("Initializing git");
    git = await initGit(options.targetDir);
  }

  return { targetDir: options.targetDir, install, git };
}

import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build, type BuildFailure, type Message, type Metafile } from "esbuild";
import { CliError } from "../errors.ts";
import { projectPaths, type EntryName } from "./paths.ts";

export interface BundleOptions {
  root: string;
  entries: readonly EntryName[];
  outDir: string;
  extension?: ".js" | ".mjs";
  inputsFile?: string;
}

export interface BuildInputs {
  builtAt: number;
  inputs: string[];
}

export interface BundleOutput {
  entry: EntryName;
  file: string;
  bytes: number;
}

export interface BundleResult {
  outputs: BundleOutput[];
  warnings: string[];
}

export class BundleError extends CliError {
  override readonly name: string = "BundleError";
}

function formatMessage(message: Message): string {
  const location = message.location;
  return location ? `${location.file}:${location.line}:${location.column}: ${message.text}` : message.text;
}

function isBuildFailure(error: unknown): error is BuildFailure {
  return error instanceof Error && Array.isArray((error as Partial<BuildFailure>).errors);
}

function projectInputs(metafile: Metafile): string[] {
  return Object.keys(metafile.inputs).filter((input) => !/(^|\/)node_modules\//.test(input) && !/^[a-z][a-z0-9-]+:/i.test(input));
}

export async function readBuildInputs(file: string): Promise<BuildInputs | null> {
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<BuildInputs>;
    const { builtAt, inputs } = parsed;
    if (typeof builtAt !== "number" || !Array.isArray(inputs) || !inputs.every((input) => typeof input === "string")) return null;
    return { builtAt, inputs };
  } catch {
    return null;
  }
}

export async function bundleEntries(options: BundleOptions): Promise<BundleResult> {
  const paths = projectPaths(options.root);
  const extension = options.extension ?? ".js";
  await mkdir(options.outDir, { recursive: true });
  await writeFile(join(options.outDir, "package.json"), '{"type":"module"}\n');

  const entryPoints = Object.fromEntries(
    options.entries.map((entry) => [entry, join(paths.entriesDir, `${entry}.ts`)]),
  );

  try {
    const builtAt = Date.now();
    const result = await build({
      absWorkingDir: options.root,
      entryPoints,
      metafile: true,
      outdir: options.outDir,
      entryNames: "[name]",
      outExtension: { ".js": extension },
      bundle: true,
      splitting: false,
      packages: "external",
      platform: "node",
      format: "esm",
      target: "node22",
      jsx: "automatic",
      jsxDev: false,
      sourcemap: "linked",
      logLevel: "silent",
      ...(existsSync(paths.tsconfig) ? { tsconfig: paths.tsconfig } : {}),
    });
    if (options.inputsFile !== undefined) {
      const recorded: BuildInputs = { builtAt, inputs: projectInputs(result.metafile) };
      await writeFile(options.inputsFile, `${JSON.stringify(recorded, null, 2)}\n`);
    }
    const outputs = await Promise.all(
      options.entries.map(async (entry) => {
        const file = join(options.outDir, `${entry}${extension}`);
        return { entry, file, bytes: (await stat(file)).size };
      }),
    );
    return { outputs, warnings: result.warnings.map(formatMessage) };
  } catch (error) {
    if (isBuildFailure(error)) {
      throw new BundleError(`Bundling failed with ${error.errors.length} error${error.errors.length === 1 ? "" : "s"}.`, {
        details: error.errors.map(formatMessage),
      });
    }
    throw error;
  }
}

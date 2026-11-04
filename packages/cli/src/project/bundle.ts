import { existsSync } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { build, type BuildFailure, type Message } from "esbuild";
import { CliError } from "../errors.ts";
import { projectPaths, type EntryName } from "./paths.ts";

export interface BundleOptions {
  root: string;
  entries: readonly EntryName[];
  outDir: string;
  extension?: ".js" | ".mjs";
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

export async function bundleEntries(options: BundleOptions): Promise<BundleResult> {
  const paths = projectPaths(options.root);
  const extension = options.extension ?? ".js";
  await mkdir(options.outDir, { recursive: true });
  await writeFile(join(options.outDir, "package.json"), '{"type":"module"}\n');

  const entryPoints = Object.fromEntries(
    options.entries.map((entry) => [entry, join(paths.entriesDir, `${entry}.ts`)]),
  );

  try {
    const result = await build({
      absWorkingDir: options.root,
      entryPoints,
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

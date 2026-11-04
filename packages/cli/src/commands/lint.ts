import { CliError } from "../errors.ts";
import { loadEnvFiles } from "../project/env.ts";
import { findProjectRoot } from "../project/paths.ts";
import { resolvePackageBin, resolveToolRunner } from "../project/runtime.ts";
import { runProcess } from "../project/spawn.ts";

export interface LintCommandOptions {
  cwd?: string | undefined;
  fix: boolean;
}

export async function runLint(options: LintCommandOptions): Promise<number> {
  const { root } = findProjectRoot(options.cwd);
  const bin = resolvePackageBin(root, "eslint");
  if (bin === null) {
    throw new CliError("ESLint is not installed in this project.", {
      hint: "Install it with: bun add -d eslint @neocord/eslint-plugin",
    });
  }
  const { env } = loadEnvFiles({ root, mode: "development", skipValidation: true });
  const { code } = await runProcess({
    command: resolveToolRunner(),
    args: [bin, ".", ...(options.fix ? ["--fix"] : [])],
    cwd: root,
    env,
  });
  return code;
}

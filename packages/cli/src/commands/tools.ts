import { CliError } from "../errors.ts";
import { resolvePackageBin, resolveToolRunner } from "../project/runtime.ts";
import { runProcess } from "../project/spawn.ts";

export interface TypecheckInput {
  root: string;
  env: Record<string, string>;
}

export async function runTypecheck(input: TypecheckInput): Promise<number> {
  const bin = resolvePackageBin(input.root, "@typescript/native", "tsc") ?? resolvePackageBin(input.root, "typescript", "tsc");
  if (bin === null) {
    throw new CliError("Could not find tsc in this project.", {
      hint: "Install it with: bun add -d typescript",
    });
  }
  const { code } = await runProcess({
    command: resolveToolRunner(),
    args: [bin, "--noEmit"],
    cwd: input.root,
    env: input.env,
  });
  return code;
}

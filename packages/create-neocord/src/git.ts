import { spawn } from "node:child_process";

export type GitResult =
  | { status: "skipped" }
  | { status: "existing-repository" }
  | { status: "failed" }
  | { status: "initialized"; committed: boolean };

function git(args: readonly string[], cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, stdio: "ignore" });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

export function isInsideGitRepository(cwd: string): Promise<boolean> {
  return git(["rev-parse", "--is-inside-work-tree"], cwd);
}

export async function initGit(cwd: string): Promise<GitResult> {
  if (await isInsideGitRepository(cwd)) return { status: "existing-repository" };
  if (!(await git(["init"], cwd))) return { status: "failed" };
  if (!(await git(["add", "-A"], cwd))) return { status: "failed" };
  const committed = await git(["commit", "-m", "chore: initial commit"], cwd);
  return { status: "initialized", committed };
}

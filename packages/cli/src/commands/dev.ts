import { createChokidarWatcher, createDevSteps, DevSession } from "../dev-session.ts";
import { findProjectRoot } from "../project/paths.ts";
import type { Ui } from "../ui.ts";

export interface DevCommandOptions {
  cwd?: string | undefined;
  shards?: number | undefined;
  deploy: boolean;
}

export async function runDev(options: DevCommandOptions, ui: Ui): Promise<number> {
  const { root } = findProjectRoot(options.cwd);
  const session = new DevSession({
    steps: createDevSteps({ root, ui, shards: options.shards, deploy: options.deploy }),
    ui,
    createWatcher: createChokidarWatcher(root),
  });

  const onSigint = (): void => void session.interrupt("SIGINT");
  const onSigterm = (): void => void session.interrupt("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  try {
    await session.start();
    return await session.waitForExit();
  } finally {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  }
}

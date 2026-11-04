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

  let interrupts = 0;
  const interrupt = (): void => {
    interrupts += 1;
    if (interrupts > 1) session.forceKill();
    void session.stop();
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);

  try {
    await session.start();
    return await session.waitForExit();
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}

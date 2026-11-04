import type { ButtonRoute, ModalRoute } from "@teamneo/neocord-react";
import { defineButton, defineCommand, type AppContext, type InferAppContext } from "neocord";
import { deployCommands, serializeCommands, startBot, startManager, validateManifest, type DeployResult, type Manifest, type ManifestIssue } from "neocord/runtime";
import { mockUser, runCommand, type TestResult } from "neocord/testing";
import type context from "./context.ts";

declare module "neocord" {
  interface RegisteredApp {
    context: import("neocord").InferAppContext<typeof import("./context.ts").default>;
  }
}

declare module "@teamneo/neocord-react" {
  interface RegisteredRoutes {
    buttons: "core/open/[id]" | "core/plain";
    selects: "core/pick";
    modals: "core/ask/[id]" | "core/plain";
  }
}

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

function assertType<T extends true>(_value?: T): void {}

assertType<Equal<InferAppContext<typeof context>, { db: { close: () => void } }>>();
assertType<Equal<AppContext, { db: { close: () => void } }>>();
assertType<Equal<ButtonRoute, "core/open/[id]" | "core/plain">>();
assertType<Equal<ModalRoute, "core/ask/[id]" | "core/plain">>();

export const command = defineCommand({
  description: "d",
  async execute(ctx) {
    assertType<Equal<typeof ctx.app, { db: { close: () => void } }>>();
    ctx.app.db.close();
    await ctx.showModal("core/ask/[id]", { id: "1" });
    await ctx.showModal("core/plain");
  },
});

export const button = defineButton("core/open/[id]", {
  execute(ctx) {
    assertType<Equal<typeof ctx.params, { id: string }>>();
  },
});

type ShowModalRoute = Parameters<Parameters<NonNullable<typeof command.execute>>[0]["showModal"]>[0];
assertType<Equal<ShowModalRoute, "core/ask/[id]" | "core/plain">>();

export async function runtimeSurface(manifest: Manifest): Promise<void> {
  const issues: ManifestIssue[] = validateManifest(manifest);
  const body = serializeCommands(manifest);
  const result: DeployResult = await deployCommands({ config: {}, manifest, dryRun: true });
  const bot = await startBot({ config: {}, manifest });
  const shards = await startManager({ config: {}, shardFile: new URL("file:///x.js"), shards: 2 });
  const tested: TestResult = await runCommand(command, { user: mockUser() });
  assertType<Equal<typeof bot.app, { db: { close: () => void } }>>();
  void [issues, body, result, shards, tested];
}

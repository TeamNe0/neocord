export { NeocordStartupError, startBot } from "./bot.ts";
export type { StartBotOptions } from "./bot.ts";
export { serializeCommands } from "./commands.ts";
export { deployCommands } from "./deploy.ts";
export type { DeployOptions, DeployResult } from "./deploy.ts";
export { startManager } from "./manager.ts";
export type { StartManagerOptions } from "./manager.ts";
export { validateManifest } from "./validate.ts";
export type { ManifestIssue } from "./validate.ts";
export type {
  Bot,
  Manifest,
  ManifestFeature,
  ManifestGroup,
  ManifestModule,
  ManifestRoute,
  ModuleNamespace,
} from "../types.ts";
export type { NeocordConfig } from "../config.ts";

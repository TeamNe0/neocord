import type { ClientOptions, GatewayIntentBits, Partials } from "discord.js";
import type { DurationInput } from "./duration.ts";
import type { LogLevel } from "./logger.ts";

export type IntentName = keyof typeof GatewayIntentBits;

export type PartialName = keyof typeof Partials;

export type ShardingMode = "process" | "worker";

export interface ShardingConfig {
  totalShards?: number | "auto";
  shardList?: readonly number[] | "auto";
  mode?: ShardingMode;
  respawn?: boolean;
  spawnDelay?: number;
  spawnTimeout?: number;
}

export interface DeployConfig {
  mode?: "manual" | "auto";
}

export interface DevConfig {
  guildId?: string | undefined;
  shards?: number;
}

export interface LiveConfig {
  ttl?: DurationInput;
}

export interface AutoDeferConfig {
  after: number;
}

export type NeocordClientOptions = Partial<Omit<ClientOptions, "intents" | "partials" | "shards" | "shardCount">>;

export interface NeocordConfig {
  readonly __neocord?: "config";
  intents?: readonly IntentName[];
  partials?: readonly PartialName[];
  client?: NeocordClientOptions;
  token?: string | undefined;
  sourceDir?: string;
  featuresDir?: string;
  runtime?: "auto" | "bun" | "node";
  sharding?: ShardingConfig;
  deploy?: DeployConfig;
  dev?: DevConfig;
  live?: LiveConfig;
  autoDefer?: AutoDeferConfig | false;
  logLevel?: LogLevel;
}

export function defineConfig<const T extends NeocordConfig>(config: T): T & { readonly __neocord: "config" } {
  return { ...config, __neocord: "config" };
}

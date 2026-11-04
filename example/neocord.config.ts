import { defineConfig } from "neocord";
import { env } from "./src/env";

export default defineConfig({
  intents: ["Guilds"],
  token: env.DISCORD_TOKEN,
  dev: { guildId: env.DEV_GUILD_ID, shards: 1 },
  sharding: { totalShards: "auto", mode: "process" },
  live: { ttl: "14m" },
  autoDefer: { after: 2000 },
  logLevel: "info",
});

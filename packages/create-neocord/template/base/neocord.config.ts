import { defineConfig } from "neocord";
import { env } from "./src/env";

export default defineConfig({
  intents: ["Guilds"],
  token: env.DISCORD_TOKEN,
  dev: { guildId: env.DEV_GUILD_ID, shards: 1 },
});

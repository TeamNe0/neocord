import { defineEvent } from "neocord";

export default defineEvent("clientReady", {
  once: true,
  execute(ctx, client) {
    const { ids, count } = ctx.shards;
    ctx.logger.info(`${client.user.tag} is ready on shard ${ids.join(", ")} of ${count}, serving ${client.guilds.cache.size} servers`);
  },
});

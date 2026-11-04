import { defineEvent } from "neocord";

export default defineEvent("clientReady", {
  once: true,
  execute(ctx, client) {
    ctx.logger.info(`Logged in as ${client.user.tag}`);
  },
});

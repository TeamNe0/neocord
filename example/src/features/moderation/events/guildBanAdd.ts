import { defineEvent } from "neocord";
import { createCase, hasActiveBan } from "../_lib/cases";

export default defineEvent("guildBanAdd", {
  async execute(ctx, ban) {
    const { db } = ctx.app;
    if (await hasActiveBan(db, ban.guild.id, ban.user.id)) return;

    const record = await createCase(db, {
      guildId: ban.guild.id,
      userId: ban.user.id,
      moderatorId: null,
      type: "ban",
      reason: ban.reason ?? "Banned outside the bot",
    });
    ctx.logger.info(`Recorded outside ban of ${ban.user.id} as case #${record.id}`);
  },
});

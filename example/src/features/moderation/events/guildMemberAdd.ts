import { defineEvent } from "neocord";
import { countActiveWarnings } from "../_lib/cases";

export default defineEvent("guildMemberAdd", {
  async execute(ctx, member) {
    const warnings = await countActiveWarnings(ctx.app.db, member.guild.id, member.id);
    if (warnings > 0) {
      ctx.logger.warn(`${member.id} rejoined ${member.guild.id} with ${warnings} active warnings`);
    }
  },
});

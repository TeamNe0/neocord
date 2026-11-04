import { defineMessageCommand } from "neocord";
import { CaseReceipt } from "../../_components/CaseReceipt";
import { createCase } from "../../_lib/cases";

export default defineMessageCommand({
  name: "Report message",
  guildOnly: true,
  ephemeral: true,
  async execute(ctx) {
    const content = ctx.target.content.trim();
    const record = await createCase(ctx.app.db, {
      guildId: ctx.guild.id,
      userId: ctx.target.author.id,
      moderatorId: ctx.user.id,
      type: "report",
      reason: content === "" ? `Message ${ctx.target.id}` : content.slice(0, 400),
    });
    return <CaseReceipt record={record} />;
  },
});

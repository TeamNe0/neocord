import { defineCommand, option } from "neocord";
import { CaseReceipt } from "../../../_components/CaseReceipt";
import { countActiveWarnings, createCase } from "../../../_lib/cases";

export default defineCommand({
  description: "Warn a member. Warnings expire after 30 days",
  guildOnly: true,
  ephemeral: true,
  options: {
    user: option.user({ description: "Who to warn", required: true }),
    reason: option.string({ description: "Why they are being warned", required: true, minLength: 3, maxLength: 400 }),
  },
  async execute(ctx) {
    const { db } = ctx.app;
    const { user, reason } = ctx.options;
    const record = await createCase(db, {
      guildId: ctx.guild.id,
      userId: user.id,
      moderatorId: ctx.user.id,
      type: "warn",
      reason,
    });
    const warnings = await countActiveWarnings(db, ctx.guild.id, user.id);
    return <CaseReceipt record={record} warnings={warnings} />;
  },
});

import { Label, TextInput } from "@neocord/react";
import { defineModal } from "neocord";
import { z } from "zod";
import { CaseReceipt } from "../../../_components/CaseReceipt";
import { countActiveWarnings, createCase } from "../../../_lib/cases";

export default defineModal("moderation/warn-reason/[userId]", {
  title: "Warn user",
  guildOnly: true,
  ephemeral: true,
  permissions: ["ModerateMembers"],
  schema: z.object({ reason: z.string().trim().min(3, "Give a reason of at least 3 characters.").max(400) }),
  render: ({ field }) => (
    <Label label="Reason">
      <TextInput customId={field("reason")} style="paragraph" maxLength={400} />
    </Label>
  ),
  async submit(ctx) {
    const { db } = ctx.app;
    const record = await createCase(db, {
      guildId: ctx.guild.id,
      userId: ctx.params.userId,
      moderatorId: ctx.user.id,
      type: "warn",
      reason: ctx.values.reason,
    });
    const warnings = await countActiveWarnings(db, ctx.guild.id, ctx.params.userId);
    return <CaseReceipt record={record} warnings={warnings} />;
  },
});

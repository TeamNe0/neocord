import { Label, Option, RadioGroup, TextInput } from "@teamneo/neocord-react";
import { defineModal } from "neocord";
import { z } from "zod";
import { CaseReceipt } from "../../../_components/CaseReceipt";
import { createCase, deleteCase } from "../../../_lib/cases";

const SECONDS_PER_DAY = 86_400;

export default defineModal("moderation/ban-reason/[userId]", {
  title: "Ban reason",
  guildOnly: true,
  permissions: ["BanMembers"],
  respond: "update",
  schema: z.object({
    reason: z.string().trim().min(3, "Give a reason of at least 3 characters.").max(400),
    history: z.enum(["0", "1", "7"]).default("0"),
  }),
  render: ({ field }) => (
    <>
      <Label label="Reason" description="Stored with the case and shown in the audit log">
        <TextInput customId={field("reason")} style="paragraph" maxLength={400} placeholder="Repeated spam" />
      </Label>
      <Label label="Delete recent messages">
        <RadioGroup customId={field("history")} required={false}>
          <Option label="Keep everything" value="0" default />
          <Option label="Last day" value="1" />
          <Option label="Last week" value="7" />
        </RadioGroup>
      </Label>
    </>
  ),
  async submit(ctx) {
    const { db } = ctx.app;
    const { userId } = ctx.params;
    const { reason, history } = ctx.values;

    const record = await createCase(db, {
      guildId: ctx.guild.id,
      userId,
      moderatorId: ctx.user.id,
      type: "ban",
      reason,
    });
    try {
      await ctx.guild.bans.create(userId, {
        reason,
        deleteMessageSeconds: Number(history) * SECONDS_PER_DAY,
      });
    } catch (error) {
      await deleteCase(db, record.id);
      throw error;
    }
    return <CaseReceipt record={record} />;
  },
});

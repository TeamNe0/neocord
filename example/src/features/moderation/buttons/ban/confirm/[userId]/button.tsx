import { defineButton } from "neocord";

export default defineButton("moderation/ban/confirm/[userId]", {
  guildOnly: true,
  permissions: ["BanMembers"],
  async execute(ctx) {
    await ctx.showModal("moderation/ban-reason/[userId]", { userId: ctx.params.userId });
  },
});

import { defineUserCommand } from "neocord";

export default defineUserCommand({
  name: "Warn user",
  guildOnly: true,
  permissions: ["ModerateMembers"],
  async execute(ctx) {
    await ctx.showModal("moderation/warn-reason/[userId]", { userId: ctx.target.id });
  },
});

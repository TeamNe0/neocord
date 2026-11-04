import { defineGroup } from "neocord";

export default defineGroup({
  description: "Moderation tools",
  guildOnly: true,
  permissions: ["ModerateMembers"],
});

import { defineCommand } from "neocord";

export default defineCommand({
  description: "Create a poll people can vote on",
  async execute(ctx) {
    await ctx.showModal("fun/poll");
  },
});

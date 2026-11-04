import { defineCommand, option } from "neocord";
import { CaseList } from "../../../../_components/CaseList";
import { listCases } from "../../../../_lib/cases";

export default defineCommand({
  description: "Show the most recent moderation cases",
  guildOnly: true,
  ephemeral: true,
  options: {
    type: option.string({
      description: "Only show one type of case",
      choices: [
        { name: "Warnings", value: "warn" },
        { name: "Bans", value: "ban" },
        { name: "Reports", value: "report" },
      ],
    }),
  },
  async execute(ctx) {
    const filter = ctx.options.type ?? "all";
    const records = await listCases(ctx.app.db, ctx.guild.id, filter);
    return <CaseList records={records} filter={filter} />;
  },
});

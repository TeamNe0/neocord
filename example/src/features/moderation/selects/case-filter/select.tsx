import { defineSelect } from "neocord";
import { CaseList } from "../../_components/CaseList";
import { listCases, toCaseFilter } from "../../_lib/cases";

export default defineSelect("moderation/case-filter", {
  guildOnly: true,
  permissions: ["ModerateMembers"],
  async execute(ctx) {
    const filter = toCaseFilter(ctx.values[0]);
    const records = await listCases(ctx.app.db, ctx.guild.id, filter);
    return <CaseList records={records} filter={filter} />;
  },
});

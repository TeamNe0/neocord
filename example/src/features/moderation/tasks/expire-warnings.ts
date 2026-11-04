import { defineTask } from "neocord";
import { expireWarnings } from "../_lib/cases";

export default defineTask({
  every: "1h",
  runOnStart: true,
  shard: "first",
  async execute(ctx) {
    const expired = await expireWarnings(ctx.app.db, new Date());
    if (expired > 0) ctx.logger.info(`Expired ${expired} warnings`);
  },
});

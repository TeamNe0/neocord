import { defineContext } from "neocord";
import { openDatabase } from "~/db/client";
import { env } from "~/env";

export default defineContext(async ({ logger }) => {
  const { db, close } = await openDatabase(env.DATABASE_URL);
  logger.info("Database ready.");
  return { value: { db }, dispose: close };
});

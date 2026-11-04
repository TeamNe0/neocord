import { defineContext } from "neocord";
import { createDatabase } from "~/db";

export default defineContext(async () => {
  const { db, close } = createDatabase();
  return { value: { db }, dispose: close };
});

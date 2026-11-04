import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "~/env";
import * as schema from "./schema";

export function createDatabase() {
  const client = createClient({ url: env.DATABASE_URL });
  const db = drizzle({ client, schema });
  return { db, close: () => client.close() };
}

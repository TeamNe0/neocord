import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "~/env";
import * as schema from "./schema";

export function createDatabase() {
  const client = postgres(env.DATABASE_URL);
  const db = drizzle({ client, schema });
  return { db, close: () => client.end() };
}

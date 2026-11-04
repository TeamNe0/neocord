import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { resolve } from "node:path";
import * as schema from "./schema";

export async function openDatabase(url: string) {
  const client = createClient({ url });
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
  return { db, close: () => client.close() };
}

export type Database = Awaited<ReturnType<typeof openDatabase>>["db"];

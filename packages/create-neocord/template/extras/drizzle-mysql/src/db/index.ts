import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { env } from "~/env";
import * as schema from "./schema";

export function createDatabase() {
  const client = mysql.createPool(env.DATABASE_URL);
  const db = drizzle({ client, schema, mode: "default" });
  return { db, close: () => client.end() };
}

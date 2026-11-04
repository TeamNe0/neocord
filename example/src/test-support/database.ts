import { openDatabase, type Database } from "~/db/client";

export interface TestDatabase {
  db: Database;
  app: { db: Database };
  close(): void;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const { db, close } = await openDatabase(":memory:");
  return { db, app: { db }, close };
}

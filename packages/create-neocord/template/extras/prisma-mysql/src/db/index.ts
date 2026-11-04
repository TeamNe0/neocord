import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { env } from "~/env";
import { PrismaClient } from "~/generated/prisma/client";

export function createDatabase() {
  const adapter = new PrismaMariaDb(env.DATABASE_URL);
  const db = new PrismaClient({ adapter });
  return { db, close: () => db.$disconnect() };
}

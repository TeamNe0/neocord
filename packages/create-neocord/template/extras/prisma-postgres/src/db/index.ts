import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "~/env";
import { PrismaClient } from "~/generated/prisma/client";

export function createDatabase() {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL });
  const db = new PrismaClient({ adapter });
  return { db, close: () => db.$disconnect() };
}

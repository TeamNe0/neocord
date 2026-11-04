import { mysqlTable, timestamp, varchar } from "drizzle-orm/mysql-core";

export const notes = mysqlTable("notes", {
  userId: varchar("user_id", { length: 32 }).primaryKey(),
  content: varchar("content", { length: 500 }).notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

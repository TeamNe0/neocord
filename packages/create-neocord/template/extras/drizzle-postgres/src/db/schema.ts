import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

export const notes = pgTable("notes", {
  userId: varchar("user_id", { length: 32 }).primaryKey(),
  content: varchar("content", { length: 500 }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

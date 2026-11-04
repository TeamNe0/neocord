import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const CASE_TYPES = ["warn", "ban", "report"] as const;

export type CaseType = (typeof CASE_TYPES)[number];

export const cases = sqliteTable(
  "moderation_cases",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    guildId: text("guild_id").notNull(),
    userId: text("user_id").notNull(),
    moderatorId: text("moderator_id"),
    type: text("type", { enum: CASE_TYPES }).notNull(),
    reason: text("reason").notNull(),
    active: integer("active", { mode: "boolean" }).notNull().default(true),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("moderation_cases_guild_idx").on(table.guildId, table.createdAt),
    index("moderation_cases_user_idx").on(table.guildId, table.userId),
  ],
);

export type ModerationCase = typeof cases.$inferSelect;

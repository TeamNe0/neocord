import { and, count, desc, eq, lte } from "drizzle-orm";
import type { Database } from "~/db/client";
import { cases, type CaseType, type ModerationCase } from "~/db/schema";

const WARNING_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export const CASE_FILTERS = ["all", "warn", "ban", "report"] as const;

export type CaseFilter = (typeof CASE_FILTERS)[number];

export function toCaseFilter(value: string | undefined): CaseFilter {
  return CASE_FILTERS.find((filter) => filter === value) ?? "all";
}

export interface NewCase {
  guildId: string;
  userId: string;
  moderatorId: string | null;
  type: CaseType;
  reason: string;
}

export async function createCase(db: Database, input: NewCase): Promise<ModerationCase> {
  const expiresAt = input.type === "warn" ? new Date(Date.now() + WARNING_LIFETIME_MS) : null;
  const [created] = await db
    .insert(cases)
    .values({ ...input, expiresAt })
    .returning();
  if (created === undefined) throw new Error("The case was not stored.");
  return created;
}

export async function deleteCase(db: Database, id: number): Promise<void> {
  await db.delete(cases).where(eq(cases.id, id));
}

export function listCases(db: Database, guildId: string, filter: CaseFilter, limit = 10): Promise<ModerationCase[]> {
  const conditions = filter === "all" ? eq(cases.guildId, guildId) : and(eq(cases.guildId, guildId), eq(cases.type, filter));
  return db.select().from(cases).where(conditions).orderBy(desc(cases.id)).limit(limit);
}

export async function countActiveWarnings(db: Database, guildId: string, userId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(cases)
    .where(and(eq(cases.guildId, guildId), eq(cases.userId, userId), eq(cases.type, "warn"), eq(cases.active, true)));
  return row?.total ?? 0;
}

export async function countCases(db: Database): Promise<number> {
  const [row] = await db.select({ total: count() }).from(cases);
  return row?.total ?? 0;
}

export async function hasActiveBan(db: Database, guildId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: cases.id })
    .from(cases)
    .where(and(eq(cases.guildId, guildId), eq(cases.userId, userId), eq(cases.type, "ban"), eq(cases.active, true)))
    .limit(1);
  return rows.length > 0;
}

export async function expireWarnings(db: Database, now: Date): Promise<number> {
  const expired = await db
    .update(cases)
    .set({ active: false })
    .where(and(eq(cases.type, "warn"), eq(cases.active, true), lte(cases.expiresAt, now)))
    .returning({ id: cases.id });
  return expired.length;
}

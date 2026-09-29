import "server-only";
import { randomBytes } from "node:crypto";
import { and, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { storm } from "@/db/schema";
import { getTimezone } from "@/lib/company";
import { fmtDate } from "@/lib/time";

export const newProofToken = () => randomBytes(24).toString("base64url");

const stormName = (d: Date, tz: string) => `Storm of ${fmtDate(d, tz)}`;

export async function openStorm(organizationId: string) {
  const [row] = await db
    .select()
    .from(storm)
    .where(and(eq(storm.organizationId, organizationId), isNull(storm.endedAt)))
    .orderBy(desc(storm.startedAt))
    .limit(1);
  return row ?? null;
}

export async function startStorm(organizationId: string, name?: string, startedAt = new Date()) {
  const [row] = await db
    .insert(storm)
    .values({ organizationId, name: name?.trim() || stormName(startedAt, await getTimezone(organizationId)), startedAt })
    .returning();
  return row;
}

/**
 * Which storm a visit belongs to: the storm whose window covers the completion time
 * (so a record uploaded late from an offline phone still lands in the right storm),
 * else the open storm, else a new one. Drivers never have to think about storms.
 */
export async function stormForVisit(organizationId: string, completedAt: Date) {
  const [covering] = await db
    .select()
    .from(storm)
    .where(
      and(
        eq(storm.organizationId, organizationId),
        lte(storm.startedAt, completedAt),
        or(isNull(storm.endedAt), gte(storm.endedAt, completedAt)),
      ),
    )
    .orderBy(desc(storm.startedAt))
    .limit(1);
  if (covering) return covering;
  return (await openStorm(organizationId)) ?? startStorm(organizationId, undefined, completedAt);
}

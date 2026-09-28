import "server-only";
import { randomBytes } from "node:crypto";
import { and, asc, desc, eq, gte, isNull, lte, or } from "drizzle-orm";
import { db } from "@/db";
import { anchor, serviceEvent, storm } from "@/db/schema";
import { anchorMemo, merkleRoot } from "@/lib/proof";
import { SOLANA_CLUSTER, writeMemo } from "@/lib/solana";
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

export type AnchorOutcome =
  | { status: "nothing" }
  | { status: "confirmed"; anchorId: string; count: number; signature: string }
  | { status: "failed"; anchorId: string; count: number; error: string };

/** Claim every not-yet-anchored record in the storm, build the Merkle tree, write the root to Solana. */
export async function anchorStorm(organizationId: string, stormId: string): Promise<AnchorOutcome> {
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .select({ id: serviceEvent.id, recordHash: serviceEvent.recordHash })
      .from(serviceEvent)
      .where(and(eq(serviceEvent.organizationId, organizationId), eq(serviceEvent.stormId, stormId), isNull(serviceEvent.anchorId)))
      .orderBy(asc(serviceEvent.completedAt), asc(serviceEvent.id))
      .for("update");
    if (rows.length === 0) return null;
    const leaves = rows.map((r) => r.recordHash);
    const root = merkleRoot(leaves);
    const id = crypto.randomUUID();
    await tx.insert(anchor).values({
      id,
      organizationId,
      stormId,
      merkleRoot: root,
      leaves,
      memo: anchorMemo(id, root),
      cluster: SOLANA_CLUSTER,
    });
    for (const r of rows) await tx.update(serviceEvent).set({ anchorId: id }).where(eq(serviceEvent.id, r.id));
    return { id, count: rows.length };
  });
  if (!claimed) return { status: "nothing" };
  return sendAnchor(claimed.id, claimed.count);
}

/** Send (or re-send after a failure) the memo for an anchor batch. The root never changes. */
export async function sendAnchor(anchorId: string, count?: number): Promise<AnchorOutcome> {
  const [a] = await db.select().from(anchor).where(eq(anchor.id, anchorId));
  const n = count ?? a.leaves.length;
  try {
    const signature = await writeMemo(a.memo);
    await db
      .update(anchor)
      .set({ status: "confirmed", txSignature: signature, error: null, confirmedAt: new Date() })
      .where(eq(anchor.id, anchorId));
    return { status: "confirmed", anchorId, count: n, signature };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`Anchor ${anchorId} failed:`, error);
    await db.update(anchor).set({ status: "failed", error: error.slice(0, 500) }).where(eq(anchor.id, anchorId));
    return { status: "failed", anchorId, count: n, error };
  }
}

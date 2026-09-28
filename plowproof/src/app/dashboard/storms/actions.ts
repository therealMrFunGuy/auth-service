"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { anchor, serviceEvent, storm } from "@/db/schema";
import { emailVisitProof, type ProofEmailOutcome } from "@/lib/notify";
import { requireDispatcher } from "@/lib/session";
import { anchorStorm, openStorm, sendAnchor, startStorm, type AnchorOutcome } from "@/lib/storms";

export async function startStormAction(formData: FormData) {
  const { membership } = await requireDispatcher();
  const existing = await openStorm(membership.organizationId);
  if (existing) redirect(`/dashboard/storms/${existing.id}`);
  const s = await startStorm(membership.organizationId, String(formData.get("name") ?? ""));
  revalidatePath("/driver");
  redirect(`/dashboard/storms/${s.id}`);
}

export async function endStormAction(stormId: string, snowfall: number | null): Promise<AnchorOutcome> {
  const { membership } = await requireDispatcher();
  await db
    .update(storm)
    .set({ endedAt: new Date(), snowfallInches: snowfall })
    .where(and(eq(storm.id, stormId), eq(storm.organizationId, membership.organizationId), isNull(storm.endedAt)));
  const outcome = await anchorStorm(membership.organizationId, stormId);
  revalidatePath(`/dashboard/storms/${stormId}`);
  revalidatePath("/driver");
  return outcome;
}

export async function anchorNowAction(stormId: string): Promise<AnchorOutcome> {
  const { membership } = await requireDispatcher();
  const outcome = await anchorStorm(membership.organizationId, stormId);
  revalidatePath(`/dashboard/storms/${stormId}`);
  return outcome;
}

export async function retryAnchorAction(anchorId: string): Promise<AnchorOutcome> {
  const { membership } = await requireDispatcher();
  const [a] = await db
    .select()
    .from(anchor)
    .where(and(eq(anchor.id, anchorId), eq(anchor.organizationId, membership.organizationId)));
  if (!a || a.status === "confirmed") return { status: "nothing" };
  const outcome = await sendAnchor(a.id);
  revalidatePath(`/dashboard/storms/${a.stormId}`);
  return outcome;
}

export async function emailProofAction(eventId: string): Promise<ProofEmailOutcome> {
  const { membership } = await requireDispatcher();
  const [ev] = await db
    .select({ id: serviceEvent.id, stormId: serviceEvent.stormId })
    .from(serviceEvent)
    .where(and(eq(serviceEvent.id, eventId), eq(serviceEvent.organizationId, membership.organizationId)));
  if (!ev) return { status: "skipped", reason: "not_found" };
  const outcome = await emailVisitProof(ev.id, { resend: true });
  revalidatePath(`/dashboard/storms/${ev.stormId}`);
  return outcome;
}

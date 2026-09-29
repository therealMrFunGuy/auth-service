"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { serviceEvent, storm } from "@/db/schema";
import { emailVisitProof, textVisitProof, type Channel, type NoticeOutcome } from "@/lib/notify";
import { requireDispatcher } from "@/lib/session";
import { openStorm, startStorm } from "@/lib/storms";

export async function startStormAction(formData: FormData) {
  const { membership } = await requireDispatcher();
  const existing = await openStorm(membership.organizationId);
  if (existing) redirect(`/dashboard/storms/${existing.id}`);
  const s = await startStorm(membership.organizationId, String(formData.get("name") ?? ""));
  revalidatePath("/driver");
  redirect(`/dashboard/storms/${s.id}`);
}

export async function endStormAction(stormId: string, snowfall: number | null) {
  const { membership } = await requireDispatcher();
  await db
    .update(storm)
    .set({ endedAt: new Date(), snowfallInches: snowfall })
    .where(and(eq(storm.id, stormId), eq(storm.organizationId, membership.organizationId), isNull(storm.endedAt)));
  revalidatePath(`/dashboard/storms/${stormId}`);
  revalidatePath("/driver");
}

export async function sendProofAction(eventId: string, channel: Channel): Promise<NoticeOutcome> {
  const { membership } = await requireDispatcher();
  const [ev] = await db
    .select({ id: serviceEvent.id, stormId: serviceEvent.stormId })
    .from(serviceEvent)
    .where(and(eq(serviceEvent.id, eventId), eq(serviceEvent.organizationId, membership.organizationId)));
  if (!ev) return { status: "skipped", reason: "not_found" };
  const outcome = await (channel === "email" ? emailVisitProof : textVisitProof)(ev.id, { resend: true });
  revalidatePath(`/dashboard/storms/${ev.stormId}`);
  return outcome;
}

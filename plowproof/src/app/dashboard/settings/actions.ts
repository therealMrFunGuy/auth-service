"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { companySettings } from "@/db/schema";
import { geocodeOne } from "@/lib/geocode";
import { getMembership, requireDispatcher } from "@/lib/session";
import { isValidTimeZone } from "@/lib/time";

export type SaveResult = { ok: true; yard: "matched" | "no_match" | "none" | "lookup_failed" } | { ok: false; error: string };

export async function saveSettings(input: { timezone: string; yardAddress: string }): Promise<SaveResult> {
  const { membership } = await requireDispatcher();
  const timezone = input.timezone.trim();
  if (!isValidTimeZone(timezone)) return { ok: false, error: "Pick a time zone from the list." };
  const yardAddress = input.yardAddress.trim().slice(0, 300) || null;

  let yardLat: number | null = null;
  let yardLng: number | null = null;
  let yard: "matched" | "no_match" | "none" | "lookup_failed" = "none";
  if (yardAddress) {
    try {
      const hit = await geocodeOne(yardAddress);
      if (hit) ({ lat: yardLat, lng: yardLng } = hit);
      yard = hit ? "matched" : "no_match";
    } catch {
      yard = "lookup_failed";
    }
  }

  const values = { timezone, yardAddress, yardLat, yardLng };
  await db
    .insert(companySettings)
    .values({ organizationId: membership.organizationId, ...values })
    .onConflictDoUpdate({ target: companySettings.organizationId, set: values });
  revalidatePath("/", "layout");
  return { ok: true, yard };
}

/** Called right after a company is created, with the owner's browser time zone. Never overwrites a saved choice. */
export async function initSettings(timezone: string) {
  const membership = await getMembership();
  if (!membership || !isValidTimeZone(timezone)) return;
  await db
    .insert(companySettings)
    .values({ organizationId: membership.organizationId, timezone })
    .onConflictDoNothing({ target: companySettings.organizationId });
}

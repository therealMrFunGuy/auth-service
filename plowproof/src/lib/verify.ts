import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organization, serviceEvent } from "@/db/schema";
import { hashBytes, hashRecord } from "@/lib/proof";
import { getObject } from "@/lib/storage";
import { getTimezone } from "@/lib/company";

export type Check = { ok: boolean | null; title: string; detail: string };

/** Re-derive every claim on the proof page from raw data rather than trusting stored flags. */
export async function verifyVisit(token: string) {
  const [row] = await db
    .select({ ev: serviceEvent, orgName: organization.name })
    .from(serviceEvent)
    .innerJoin(organization, eq(organization.id, serviceEvent.organizationId))
    .where(eq(serviceEvent.proofToken, token));
  if (!row) return null;
  const ev = row.ev;
  const tz = await getTimezone(ev.organizationId);
  const checks: Check[] = [];

  // 1. The record itself.
  const recomputed = hashRecord({ ...ev, photoHashes: ev.photos.map((p) => p.sha256) });
  checks.push(
    recomputed === ev.recordHash
      ? { ok: true, title: "Record unchanged", detail: "Time, location, notes, and photo fingerprints match what was logged." }
      : { ok: false, title: "Record was changed", detail: "The stored details no longer match the fingerprint taken when it was logged." },
  );

  // 2. The photos.
  if (ev.photos.length > 0) {
    const results = await Promise.all(
      ev.photos.map(async (p) => {
        const bytes = await getObject(p.key).catch(() => null);
        return bytes ? hashBytes(bytes) === p.sha256 : null;
      }),
    );
    const bad = results.filter((r) => r === false).length;
    const missing = results.filter((r) => r === null).length;
    checks.push(
      bad > 0
        ? { ok: false, title: "A photo was altered", detail: `${bad} of ${ev.photos.length} photos don't match their fingerprints.` }
        : missing > 0
          ? { ok: null, title: "Photos unavailable", detail: `${missing} of ${ev.photos.length} photos couldn't be loaded to check.` }
          : { ok: true, title: "Photos are originals", detail: ev.photos.length === 1 ? "The photo matches the fingerprint in the record." : `All ${ev.photos.length} photos match the fingerprints in the record.` },
    );
  }

  return { ev, orgName: row.orgName, tz, checks };
}

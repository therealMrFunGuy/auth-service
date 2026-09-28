import { and, eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { customer, serviceEvent, type PhotoRef } from "@/db/schema";
import { formatAddress } from "@/lib/address";
import { distanceMeters } from "@/lib/geo";
import { notifyCustomerOfVisit } from "@/lib/notify";
import { hashBytes, hashRecord } from "@/lib/proof";
import { getMembership, getSession } from "@/lib/session";
import { putObject } from "@/lib/storage";
import { newProofToken, stormForVisit } from "@/lib/storms";

export const maxDuration = 60;

const MAX_PHOTOS = 6;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const num = z.preprocess((v) => (v === "" || v == null ? null : Number(v)), z.number().finite().nullable());
const fieldsSchema = z.object({
  clientId: z.string().uuid(),
  customerId: z.string().min(1),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date(),
  lat: num.pipe(z.number().min(-90).max(90).nullable()),
  lng: num.pipe(z.number().min(-180).max(180).nullable()),
  accuracyM: num.pipe(z.number().min(0).nullable()),
  notes: z.string().trim().max(1000).optional().transform((v) => v || null),
});

type Result = { id: string; proofToken: string; duplicate?: boolean } | { error: string };
const json = (b: Result, status = 200) => NextResponse.json(b, { status });

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return json({ error: "Sign in again to upload this visit." }, 401);
  const membership = await getMembership();
  if (!membership) return json({ error: "You're not on a crew yet." }, 403);
  const orgId = membership.organizationId;

  const form = await req.formData();
  const parsed = fieldsSchema.safeParse(Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === "string")));
  if (!parsed.success) return json({ error: `Visit data was incomplete: ${parsed.error.issues[0]?.message}` }, 400);
  const f = parsed.data;

  // Clock sanity: phones can be off, but not by days, and a visit can't end before it starts.
  const now = Date.now();
  if (f.completedAt.getTime() < f.startedAt.getTime()) return json({ error: "Finish time is before start time." }, 400);
  if (f.completedAt.getTime() > now + 10 * 60_000) return json({ error: "Phone clock is ahead. Check the date and time settings." }, 400);
  if (now - f.startedAt.getTime() > 14 * 24 * 3600_000) return json({ error: "This visit is more than 14 days old." }, 400);

  // Offline retries resend the same clientId. Return the original instead of logging twice.
  const [existing] = await db
    .select({ id: serviceEvent.id, proofToken: serviceEvent.proofToken })
    .from(serviceEvent)
    .where(and(eq(serviceEvent.organizationId, orgId), eq(serviceEvent.clientId, f.clientId)));
  if (existing) return json({ ...existing, duplicate: true });

  const [cust] = await db
    .select()
    .from(customer)
    .where(and(eq(customer.id, f.customerId), eq(customer.organizationId, orgId)));
  if (!cust) return json({ error: "That property isn't in your company's list anymore." }, 404);

  const files = form.getAll("photos").filter((p): p is File => p instanceof File && p.size > 0);
  if (files.length > MAX_PHOTOS) return json({ error: `Up to ${MAX_PHOTOS} photos per visit.` }, 400);

  const id = crypto.randomUUID();
  const photos: PhotoRef[] = [];
  for (const file of files) {
    if (!PHOTO_TYPES.has(file.type)) return json({ error: `${file.name || "A photo"} isn't a JPG, PNG, or WebP.` }, 400);
    if (file.size > MAX_PHOTO_BYTES) return json({ error: "A photo is over 8 MB." }, 400);
    const bytes = Buffer.from(await file.arrayBuffer());
    const sha256 = hashBytes(bytes); // hashed server-side from the exact bytes stored
    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const key = `${orgId}/${id}/${sha256}.${ext}`;
    await putObject(key, bytes, file.type);
    photos.push({ sha256, key, bytes: bytes.length, contentType: file.type });
  }

  const storm = await stormForVisit(orgId, f.completedAt);
  const addressSnapshot = `${cust.name}, ${formatAddress(cust)}`;
  const distanceM =
    f.lat != null && f.lng != null && cust.lat != null && cust.lng != null
      ? Math.round(distanceMeters({ lat: f.lat, lng: f.lng }, { lat: cust.lat, lng: cust.lng }))
      : null;

  const record = {
    id,
    organizationId: orgId,
    stormId: storm.id,
    customerId: cust.id,
    addressSnapshot,
    driverUserId: session.user.id,
    startedAt: f.startedAt,
    completedAt: f.completedAt,
    lat: f.lat,
    lng: f.lng,
    accuracyM: f.accuracyM,
    notes: f.notes,
  };
  const recordHash = hashRecord({ ...record, photoHashes: photos.map((p) => p.sha256) });
  const proofToken = newProofToken();

  const inserted = await db
    .insert(serviceEvent)
    .values({
      ...record,
      driverName: session.user.name || session.user.email,
      clientId: f.clientId,
      distanceM,
      photos,
      recordHash,
      proofToken,
    })
    .onConflictDoNothing({ target: [serviceEvent.organizationId, serviceEvent.clientId] })
    .returning({ id: serviceEvent.id });

  if (inserted.length === 0) {
    // Two retries raced; the other one won.
    const [winner] = await db
      .select({ id: serviceEvent.id, proofToken: serviceEvent.proofToken })
      .from(serviceEvent)
      .where(and(eq(serviceEvent.organizationId, orgId), eq(serviceEvent.clientId, f.clientId)));
    return json({ ...winner, duplicate: true });
  }

  // Send the proof link to the customer once the driver has their response.
  if ((cust.email && cust.emailProof) || (cust.phone && cust.textProof)) after(() => notifyCustomerOfVisit(id));
  return json({ id, proofToken }, 201);
}

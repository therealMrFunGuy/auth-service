import { createHash } from "node:crypto";

/**
 * Proof-of-service hashing.
 *
 * recordHash = sha256 of a fixed-order JSON array of the record's fields, taken when the visit
 * uploads. Anyone holding the record can recompute it; changing any field (time, GPS, notes,
 * a photo) changes the hash, so the proof page shows the edit.
 */

export const HASH_VERSION = "plowproof:v1";

export type HashableRecord = {
  id: string;
  organizationId: string;
  stormId: string;
  customerId: string | null;
  addressSnapshot: string;
  driverUserId: string | null;
  startedAt: Date;
  completedAt: Date;
  lat: number | null;
  lng: number | null;
  accuracyM: number | null;
  photoHashes: string[];
  notes: string | null;
};

const sha256 = (data: Buffer | string) => createHash("sha256").update(data).digest();

export function hashRecord(r: HashableRecord): string {
  const canonical = JSON.stringify([
    HASH_VERSION,
    r.id,
    r.organizationId,
    r.stormId,
    r.customerId,
    r.addressSnapshot,
    r.driverUserId,
    r.startedAt.toISOString(),
    r.completedAt.toISOString(),
    r.lat,
    r.lng,
    r.accuracyM,
    r.photoHashes,
    r.notes,
  ]);
  return sha256(canonical).toString("hex");
}

export const hashBytes = (data: Buffer) => sha256(data).toString("hex");

import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { anchor, organization, serviceEvent } from "@/db/schema";
import { hashBytes, hashRecord, merkleProof, merkleRoot, verifyMerkleProof, type ProofStep } from "@/lib/proof";
import { anchorKeypair, readMemo, type OnchainMemo } from "@/lib/solana";
import { getObject } from "@/lib/storage";
import { fmtDateTime } from "@/lib/time";

export type Check = { ok: boolean | null; title: string; detail: string };

const withTimeout = <T,>(p: Promise<T>, ms: number) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Solana RPC timed out")), ms))]);

/** Re-derive every claim on the proof page from raw data rather than trusting stored flags. */
export async function verifyVisit(token: string) {
  const [row] = await db
    .select({ ev: serviceEvent, orgName: organization.name })
    .from(serviceEvent)
    .innerJoin(organization, eq(organization.id, serviceEvent.organizationId))
    .where(eq(serviceEvent.proofToken, token));
  if (!row) return null;
  const ev = row.ev;
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

  // 3. Inclusion in a sealed batch, and 4. the batch root on Solana.
  let proof: ProofStep[] = [];
  let onchain: OnchainMemo | null = null;
  let a: typeof anchor.$inferSelect | null = null;
  if (ev.anchorId) [a] = await db.select().from(anchor).where(eq(anchor.id, ev.anchorId));

  if (!a) {
    checks.push({ ok: null, title: "Not sealed yet", detail: "Records are sealed on Solana when the storm ends." });
  } else {
    const idx = a.leaves.indexOf(ev.recordHash);
    proof = idx >= 0 ? merkleProof(a.leaves, idx) : [];
    const included = idx >= 0 && merkleRoot(a.leaves) === a.merkleRoot && verifyMerkleProof(ev.recordHash, proof, a.merkleRoot);
    checks.push(
      included
        ? { ok: true, title: "Part of a sealed batch", detail: `One of ${a.leaves.length} records combined into a single fingerprint for this storm.` }
        : { ok: false, title: "Not in its batch", detail: "This record's fingerprint isn't in the batch it claims to belong to." },
    );

    if (a.status !== "confirmed" || !a.txSignature) {
      checks.push({ ok: null, title: "Waiting for Solana", detail: "The batch is saved but hasn't been written to the blockchain yet." });
    } else {
      try {
        onchain = await withTimeout(readMemo(a.txSignature), 8_000);
        let signerOk = true;
        try {
          signerOk = !onchain || onchain.signer === anchorKeypair().publicKey.toBase58();
        } catch {
          /* key not configured on this server: skip signer check */
        }
        checks.push(
          onchain && onchain.memo === a.memo && signerOk
            ? {
                ok: true,
                title: "Recorded on Solana",
                detail: `The batch fingerprint is on the public Solana blockchain${onchain.blockTime ? ` as of ${fmtDateTime(onchain.blockTime)}` : ""}. It can't be edited or deleted.`,
              }
            : { ok: false, title: "Blockchain doesn't match", detail: "The transaction on Solana doesn't contain this batch's fingerprint." },
        );
      } catch (err) {
        checks.push({ ok: null, title: "Couldn't reach Solana", detail: `${err instanceof Error ? err.message : "Network error"}. Reload to try again.` });
      }
    }
  }

  return { ev, orgName: row.orgName, anchor: a, proof, onchain, checks };
}

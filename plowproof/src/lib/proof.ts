import { createHash } from "node:crypto";

/**
 * Proof-of-service hashing.
 *
 * recordHash = sha256 of a fixed-order JSON array of the record's fields. Anyone holding the
 * record can recompute it; changing any field (time, GPS, a photo) changes the hash.
 *
 * Records in a batch become leaves of a Merkle tree. Only the root goes on Solana, so one
 * ~5,000-lamport memo transaction covers a whole storm, and any single record can be proven
 * with its sibling hashes without revealing the other customers.
 *
 * Domain separation (0x00 for leaves, 0x01 for inner nodes) blocks second-preimage tricks
 * where an inner node is passed off as a leaf.
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

const leafNode = (hex: string) => sha256(Buffer.concat([Buffer.from([0x00]), Buffer.from(hex, "hex")]));
const innerNode = (l: Buffer, r: Buffer) => sha256(Buffer.concat([Buffer.from([0x01]), l, r]));

/** Build every level of the tree. Odd nodes are promoted unchanged to the next level. */
function levels(leaves: string[]): Buffer[][] {
  if (leaves.length === 0) throw new Error("Cannot build a Merkle tree with no leaves");
  const out: Buffer[][] = [leaves.map(leafNode)];
  while (out[out.length - 1].length > 1) {
    const cur = out[out.length - 1];
    const next: Buffer[] = [];
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? innerNode(cur[i], cur[i + 1]) : cur[i]);
    out.push(next);
  }
  return out;
}

export function merkleRoot(leaves: string[]): string {
  const lv = levels(leaves);
  return lv[lv.length - 1][0].toString("hex");
}

export type ProofStep = { hash: string; side: "left" | "right" };

export function merkleProof(leaves: string[], index: number): ProofStep[] {
  const lv = levels(leaves);
  const proof: ProofStep[] = [];
  let i = index;
  for (let d = 0; d < lv.length - 1; d++) {
    const level = lv[d];
    const sibling = i % 2 === 0 ? i + 1 : i - 1;
    if (sibling < level.length) proof.push({ hash: level[sibling].toString("hex"), side: i % 2 === 0 ? "right" : "left" });
    i = Math.floor(i / 2);
  }
  return proof;
}

export function verifyMerkleProof(leafHex: string, proof: ProofStep[], rootHex: string): boolean {
  let node = leafNode(leafHex);
  for (const step of proof) {
    const sib = Buffer.from(step.hash, "hex");
    node = step.side === "right" ? innerNode(node, sib) : innerNode(sib, node);
  }
  return node.toString("hex") === rootHex;
}

export const anchorMemo = (anchorId: string, root: string) => `${HASH_VERSION}:${anchorId}:${root}`;

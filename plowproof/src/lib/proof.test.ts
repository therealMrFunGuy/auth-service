import { describe, expect, it } from "vitest";
import { hashRecord, merkleProof, merkleRoot, verifyMerkleProof, type HashableRecord } from "./proof";

const record: HashableRecord = {
  id: "v1",
  organizationId: "org",
  stormId: "storm",
  customerId: "cust",
  addressSnapshot: "Jane Smith, 2140 4th St, Minneapolis, MN",
  driverUserId: "u1",
  startedAt: new Date("2026-01-10T11:00:00Z"),
  completedAt: new Date("2026-01-10T11:12:00Z"),
  lat: 44.98,
  lng: -93.26,
  accuracyM: 8,
  notes: "Salted the steps",
  photoHashes: ["a".repeat(64)],
};

describe("hashRecord", () => {
  it("is stable and changes when any field changes", () => {
    expect(hashRecord(record)).toBe(hashRecord({ ...record }));
    expect(hashRecord({ ...record, notes: "Salted the step" })).not.toBe(hashRecord(record));
    expect(hashRecord({ ...record, completedAt: new Date("2026-01-10T11:13:00Z") })).not.toBe(hashRecord(record));
    expect(hashRecord({ ...record, photoHashes: ["b".repeat(64)] })).not.toBe(hashRecord(record));
  });
});

describe("merkle", () => {
  const leaves = Array.from({ length: 7 }, (_, i) => hashRecord({ ...record, id: `v${i}` }));

  it("proves every leaf in odd-sized trees", () => {
    for (let n = 1; n <= leaves.length; n++) {
      const set = leaves.slice(0, n);
      const root = merkleRoot(set);
      set.forEach((leaf, i) => expect(verifyMerkleProof(leaf, merkleProof(set, i), root)).toBe(true));
    }
  });

  it("rejects a leaf that isn't in the batch or a tampered root", () => {
    const root = merkleRoot(leaves);
    const outsider = hashRecord({ ...record, id: "intruder" });
    expect(verifyMerkleProof(outsider, merkleProof(leaves, 2), root)).toBe(false);
    expect(verifyMerkleProof(leaves[2], merkleProof(leaves, 2), "0".repeat(64))).toBe(false);
  });
});

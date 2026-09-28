import { describe, expect, it } from "vitest";
import { toE164 } from "./sms";

describe("toE164", () => {
  it("normalizes common North American formats", () => {
    for (const raw of ["(612) 555-0142", "612-555-0142", "612.555.0142", "6125550142", "1 612 555 0142", "+1 612-555-0142", "612-555-0142 x12"])
      expect(toE164(raw)).toBe("+16125550142");
  });
  it("rejects numbers that can't be texted", () => {
    for (const raw of ["", "555-0142", "012-555-0142", "call the office", null, undefined]) expect(toE164(raw)).toBeNull();
  });
  it("keeps international numbers written with +", () => {
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
  });
});

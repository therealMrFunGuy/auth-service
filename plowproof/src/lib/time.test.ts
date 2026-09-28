import { describe, expect, it } from "vitest";
import { seasonStartYmd, startOfDayIn, ymdIn } from "./time";

describe("startOfDayIn", () => {
  it("finds local midnight in winter and summer", () => {
    expect(startOfDayIn("2026-01-15", "America/Chicago").toISOString()).toBe("2026-01-15T06:00:00.000Z");
    expect(startOfDayIn("2026-07-15", "America/Chicago").toISOString()).toBe("2026-07-15T05:00:00.000Z");
    expect(startOfDayIn("2026-01-15", "America/St_Johns").toISOString()).toBe("2026-01-15T03:30:00.000Z");
  });
  it("handles DST change days", () => {
    expect(startOfDayIn("2026-03-08", "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(startOfDayIn("2026-11-01", "America/New_York").toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });
});

describe("ymdIn / seasonStartYmd", () => {
  it("uses the local date, not UTC", () => {
    const lateEvening = new Date("2026-01-16T04:30:00Z"); // 10:30 PM Jan 15 in Chicago
    expect(ymdIn(lateEvening, "America/Chicago")).toBe("2026-01-15");
  });
  it("starts seasons on July 1", () => {
    expect(seasonStartYmd(new Date("2026-01-15T12:00:00Z"), "America/Chicago")).toBe("2025-07-01");
    expect(seasonStartYmd(new Date("2026-11-15T12:00:00Z"), "America/Chicago")).toBe("2026-07-01");
  });
});

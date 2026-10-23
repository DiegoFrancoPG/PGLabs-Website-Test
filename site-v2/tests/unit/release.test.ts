import { describe, it, expect } from "vitest";
import { formatRelease, isHeldBack } from "@/lib/release";

describe("module release dates (D-08)", () => {
  const now = "2026-10-23T12:00:00Z";

  it("holds a module back only until its date", () => {
    expect(isHeldBack(null, now)).toBe(false);
    expect(isHeldBack("2026-10-23T12:00:01Z", now)).toBe(true);
    expect(isHeldBack("2026-10-23T12:00:00Z", now)).toBe(false);
    expect(isHeldBack("2026-10-01T00:00:00Z", now)).toBe(false);
  });

  it("shows the day, and the time only when it is not midnight in that zone", () => {
    expect(formatRelease("2026-11-03T08:00:00Z", "America/Vancouver")).toBe("Nov 3, 2026");
    expect(formatRelease("2026-11-03T17:30:00Z", "America/Vancouver")).toBe("Nov 3, 2026, 9:30 AM");
    expect(formatRelease("2026-11-03T00:00:00Z", "UTC")).toBe("Nov 3, 2026");
  });
});

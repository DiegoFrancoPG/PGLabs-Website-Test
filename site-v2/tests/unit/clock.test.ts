import { describe, it, expect } from "vitest";
import { systemClock, fixedClock } from "@/lib/clock";

describe("clock", () => {
  it("systemClock returns the current instant", () => {
    const before = Date.now();
    const now = systemClock.now().getTime();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it("fixedClock does not move on its own", () => {
    const clock = fixedClock("2026-09-15T12:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-09-15T12:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-09-15T12:00:00.000Z");
  });

  it("fixedClock moves only when the test advances it", () => {
    const clock = fixedClock("2026-09-15T12:00:00.000Z");
    clock.advance(60_000);
    expect(clock.now().toISOString()).toBe("2026-09-15T12:01:00.000Z");
  });

  it("hands out copies, so a caller cannot mutate the clock", () => {
    const clock = fixedClock("2026-09-15T12:00:00.000Z");
    const handed = clock.now();
    handed.setFullYear(2030);
    expect(clock.now().toISOString()).toBe("2026-09-15T12:00:00.000Z");
  });

  it("rejects an invalid instant rather than yielding an Invalid Date", () => {
    expect(() => fixedClock("not-a-date")).toThrow(TypeError);
  });
});

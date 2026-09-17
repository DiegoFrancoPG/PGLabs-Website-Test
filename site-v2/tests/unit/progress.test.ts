import { describe, it, expect } from "vitest";
import {
  unionRanges,
  coverageMs,
  meetsCoverageThreshold,
  maxPlausibleIntervalMs,
  validateHeartbeat,
  ProgressError,
  type Range,
} from "@/lib/progress";

const DURATION = 600_000; // ten minutes, like the fixture's video

describe("AC-025 interval coverage threshold", () => {
  it("counts [0,539999) as incomplete, one millisecond short", () => {
    const ranges = unionRanges([], [0, 539_999]);
    const coverage = coverageMs(ranges, DURATION);
    expect(coverage).toBe(539_999);
    expect(meetsCoverageThreshold(coverage, DURATION)).toBe(false);
  });

  it("completes at exactly 540000, which is exactly 90 percent", () => {
    const ranges = unionRanges([[0, 539_999]], [539_999, 540_000]);
    const coverage = coverageMs(ranges, DURATION);
    expect(coverage).toBe(540_000);
    expect(meetsCoverageThreshold(coverage, DURATION)).toBe(true);
  });

  it("adds zero coverage for an overlapping replay", () => {
    /*
     * ADR-09 says UNIQUE coverage. Watching the same three minutes twice is
     * three minutes, and a naive sum would report six.
     */
    let ranges: Range[] = unionRanges([], [0, 180_000]);
    const once = coverageMs(ranges, DURATION);
    ranges = unionRanges(ranges, [0, 180_000]);
    ranges = unionRanges(ranges, [60_000, 120_000]);
    expect(coverageMs(ranges, DURATION)).toBe(once);
    expect(ranges).toEqual([[0, 180_000]]);
  });

  it("merges overlapping and touching intervals into one", () => {
    let ranges: Range[] = [];
    for (const r of [[0, 100], [200, 300], [90, 210], [300, 400]] as Range[]) {
      ranges = unionRanges(ranges, r);
    }
    expect(ranges).toEqual([[0, 400]]);
  });

  it("keeps disjoint intervals separate and in order", () => {
    let ranges: Range[] = [];
    for (const r of [[500, 600], [0, 100], [200, 300]] as Range[]) {
      ranges = unionRanges(ranges, r);
    }
    expect(ranges).toEqual([[0, 100], [200, 300], [500, 600]]);
  });

  it("caps coverage at the media length", () => {
    // Defensive: the validator already refuses an interval past the end.
    expect(coverageMs([[0, 700_000]], DURATION)).toBe(DURATION);
  });

  it("uses integer arithmetic, so no duration depends on floating point", () => {
    // 0.9 * 1000003 is not representable; 90 * 1000003 / 100 is decidable.
    const odd = 1_000_003;
    const ninety = Math.ceil((odd * 90) / 100);
    expect(meetsCoverageThreshold(ninety, odd)).toBe(true);
    expect(meetsCoverageThreshold(ninety - 1, odd)).toBe(false);
  });
});

describe("AC-026 seek is not playback", () => {
  it("credits only what could have been played, however far the position moved", () => {
    /*
     * The player seeks to 590000 and claims [590000,600000). Fifteen seconds
     * at rate 1 can cover ten seconds, so the claim is plausible and is
     * credited — but ONLY that ten seconds, not the 590 seconds skipped.
     */
    const ranges = unionRanges([], [590_000, 600_000]);
    expect(() =>
      validateHeartbeat({
        positionMs: 600_000,
        elapsedMs: 15_000,
        rate: 1,
        interval: [590_000, 600_000],
        durationMs: DURATION,
        msSinceLastHeartbeat: 15_000,
      })
    ).not.toThrow();
    expect(coverageMs(ranges, DURATION)).toBe(10_000);
    expect(meetsCoverageThreshold(10_000, DURATION)).toBe(false);
  });

  it("does not let a position at the end stand in for coverage", () => {
    // Position is where the playhead is; coverage is what was watched.
    expect(meetsCoverageThreshold(coverageMs([], DURATION), DURATION)).toBe(false);
  });
});

describe("AC-029 impossible progress evidence", () => {
  const base = {
    positionMs: 100_000,
    elapsedMs: 15_000,
    rate: 1,
    durationMs: DURATION,
    msSinceLastHeartbeat: 15_000,
  };

  it("rejects an interval far longer than the elapsed time could cover", () => {
    expect(() => validateHeartbeat({ ...base, interval: [0, 500_000] })).toThrow(ProgressError);
  });

  it("bounds an interval by elapsed × rate plus a rounding allowance", () => {
    // 15s at rate 1 → 15000 + 1000 = 16000ms allowed.
    expect(maxPlausibleIntervalMs(base)).toBe(16_000);
    expect(() => validateHeartbeat({ ...base, interval: [0, 16_000] })).not.toThrow();
    expect(() => validateHeartbeat({ ...base, interval: [0, 16_001] })).toThrow(/exceeds/);
  });

  it("scales the bound with the playback rate", () => {
    expect(maxPlausibleIntervalMs({ ...base, rate: 2 })).toBe(31_000);
    expect(maxPlausibleIntervalMs({ ...base, rate: 0.5 })).toBe(8_500);
  });

  it("uses the server's clock, not the client's, when they disagree", () => {
    // The client claims 15s elapsed but the server saw this player 3s ago.
    // Only 3s + 2s slack can be believed.
    expect(maxPlausibleIntervalMs({ ...base, msSinceLastHeartbeat: 3_000 })).toBe(6_000);
  });

  it("never allows more than 60 seconds in one heartbeat", () => {
    expect(maxPlausibleIntervalMs({ elapsedMs: 30_000, msSinceLastHeartbeat: 10_000_000, rate: 2 })).toBe(
      60_000
    );
  });

  it("rejects a played interval with no elapsed time", () => {
    expect(() => validateHeartbeat({ ...base, elapsedMs: 0, interval: [0, 1_000] })).toThrow(
      /needs elapsed time/
    );
  });

  it("allows a pure position save with no interval and no elapsed time", () => {
    // Paused or backgrounded: spec/03 says these send no growing interval.
    expect(() => validateHeartbeat({ ...base, elapsedMs: 0, interval: null })).not.toThrow();
  });

  it.each([
    ["a negative position", { positionMs: -1, interval: null }],
    ["a position past the end", { positionMs: 600_001, interval: null }],
    ["a negative interval start", { interval: [-1, 1_000] as Range }],
    ["an interval past the end", { interval: [599_000, 600_001] as Range }],
    ["an empty interval", { interval: [1_000, 1_000] as Range }],
    ["a reversed interval", { interval: [2_000, 1_000] as Range }],
    ["a fractional position", { positionMs: 100.5, interval: null }],
    ["elapsed over the contract's 30 second cap", { elapsedMs: 30_001, interval: null }],
    ["a rate below 0.5", { rate: 0.25, interval: null }],
    ["a rate above 2", { rate: 4, interval: null }],
  ])("rejects %s", (_name, overrides) => {
    expect(() => validateHeartbeat({ ...base, ...overrides })).toThrow(ProgressError);
  });

  it("names INVALID_PROGRESS, which spec/05 maps to 422", () => {
    try {
      validateHeartbeat({ ...base, interval: [0, 500_000] });
    } catch (err) {
      expect((err as ProgressError).code).toBe("INVALID_PROGRESS");
    }
  });
});

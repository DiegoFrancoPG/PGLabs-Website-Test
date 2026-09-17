/*
 * Playback progress rules, as pure logic.
 *
 * The database is the authority — it holds played_ranges as an int8multirange
 * and applies these same rules inside the heartbeat transaction. This module
 * exists so the rules can be tested at the unit level (AC-025, AC-026, AC-029)
 * and so the player can pre-validate a heartbeat before sending it.
 *
 * ADR-09: "Media completion requires 90% of unique played timeline coverage."
 * UNIQUE is the word that matters. Replaying the same minute ten times is one
 * minute of coverage, and seeking to the end is no coverage at all.
 */

/** A half-open interval [start, end) in milliseconds, like int8range. */
export type Range = readonly [start: number, end: number];

export class ProgressError extends Error {
  constructor(
    readonly code: "INVALID_PROGRESS",
    message: string
  ) {
    super(message);
    this.name = "ProgressError";
  }
}

/** Longest interval a single heartbeat may claim, whatever it says elapsed. */
export const MAX_INTERVAL_MS = 60_000;
/** Longest elapsed a heartbeat may report; the contract caps it too. */
export const MAX_ELAPSED_MS = 30_000;
/** Slack for clock skew between the player's clock and the server's. */
export const CLOCK_SLACK_MS = 2_000;
/** Extra allowance on every accepted interval, for rounding. */
export const INTERVAL_ALLOWANCE_MS = 1_000;

/**
 * Unions a new interval into a set of disjoint, sorted ranges. Mirrors what
 * `played_ranges || int8range(start, end)` does in Postgres: overlapping and
 * adjacent ranges merge, so the result never double-counts.
 */
export function unionRanges(existing: readonly Range[], added: Range): Range[] {
  const [start, end] = added;
  if (end <= start) return [...existing];

  const merged: Range[] = [];
  let lo = start;
  let hi = end;
  let placed = false;

  for (const [s, e] of existing) {
    if (e < lo) {
      merged.push([s, e]);
    } else if (s > hi) {
      if (!placed) {
        merged.push([lo, hi]);
        placed = true;
      }
      merged.push([s, e]);
    } else {
      // Overlapping or touching: absorb into the new interval.
      lo = Math.min(lo, s);
      hi = Math.max(hi, e);
    }
  }
  if (!placed) merged.push([lo, hi]);
  return merged;
}

/** Total unique milliseconds covered, capped at the media length. */
export function coverageMs(ranges: readonly Range[], durationMs: number): number {
  const total = ranges.reduce((sum, [s, e]) => sum + (e - s), 0);
  return Math.min(total, durationMs);
}

/**
 * spec/03: "Criterion is coverage*100 >= duration_ms*90 using integer
 * arithmetic." Integer on purpose — 0.9 * 600000 is exactly 540000 in
 * floating point today, but the rule must not depend on that being true for
 * every duration.
 */
export function meetsCoverageThreshold(coverage: number, durationMs: number): boolean {
  return coverage * 100 >= durationMs * 90;
}

/**
 * spec/03 step 3: "Require interval length <= min(elapsed_ms,
 * max(0, server_now - last_received_at) + 2,000) × rate + 1,000 and <= 60,000
 * ms. Positive length must have elapsed_ms > 0."
 *
 * The bound is what makes a seek different from playback (AC-026): fifteen
 * seconds of wall clock at rate 1 can never justify a 500,000ms interval,
 * whatever position the player reports.
 */
export function maxPlausibleIntervalMs(input: {
  elapsedMs: number;
  msSinceLastHeartbeat: number;
  rate: number;
}): number {
  const window = Math.min(
    input.elapsedMs,
    Math.max(0, input.msSinceLastHeartbeat) + CLOCK_SLACK_MS
  );
  return Math.min(Math.floor(window * input.rate) + INTERVAL_ALLOWANCE_MS, MAX_INTERVAL_MS);
}

export interface HeartbeatInput {
  positionMs: number;
  elapsedMs: number;
  rate: number;
  interval: Range | null;
  durationMs: number;
  msSinceLastHeartbeat: number;
}

/**
 * Everything spec/03 says a heartbeat must satisfy before it can be credited.
 * Throws INVALID_PROGRESS with a reason; spec/05 maps that to 422.
 */
export function validateHeartbeat(input: HeartbeatInput): void {
  const { positionMs, elapsedMs, rate, interval, durationMs } = input;

  if (!Number.isInteger(positionMs) || positionMs < 0 || positionMs > durationMs) {
    throw new ProgressError("INVALID_PROGRESS", "position is outside the media");
  }
  if (!Number.isInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > MAX_ELAPSED_MS) {
    throw new ProgressError("INVALID_PROGRESS", "elapsed time is outside the allowed range");
  }
  if (!(rate >= 0.5 && rate <= 2)) {
    throw new ProgressError("INVALID_PROGRESS", "rate must be between 0.5 and 2");
  }

  if (interval === null) return;

  const [start, end] = interval;
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new ProgressError("INVALID_PROGRESS", "interval bounds must be integers");
  }
  if (start < 0 || end > durationMs || end <= start) {
    throw new ProgressError("INVALID_PROGRESS", "interval is outside the media or empty");
  }

  const length = end - start;
  if (length > 0 && elapsedMs <= 0) {
    throw new ProgressError("INVALID_PROGRESS", "a played interval needs elapsed time");
  }
  const limit = maxPlausibleIntervalMs(input);
  if (length > limit) {
    throw new ProgressError(
      "INVALID_PROGRESS",
      `interval of ${length}ms exceeds what ${elapsedMs}ms of playback could cover`
    );
  }
}

/*
 * spec/05: "Clock.now(): Date; real clock in production, fixed clock in tests.
 * No production HTTP parameter overrides it."
 *
 * Time decides access (ADR-10: start inclusive, hard end exclusive), completion
 * timestamps and reminder eligibility, so it is injected rather than read from
 * `new Date()` at the call site. Nothing here reads a header, query parameter
 * or request body — a caller cannot move the clock.
 */

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

/**
 * Test-only. A frozen clock, or one the test advances explicitly.
 * Never construct this from request data.
 */
export function fixedClock(instant: Date | string): Clock & { advance(ms: number): void } {
  let current = instant instanceof Date ? new Date(instant) : new Date(instant);
  if (Number.isNaN(current.getTime())) {
    throw new TypeError(`fixedClock: invalid instant ${String(instant)}`);
  }
  return {
    now: () => new Date(current),
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
  };
}

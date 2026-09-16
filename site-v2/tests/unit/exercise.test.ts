import { describe, it, expect } from "vitest";
import {
  normalizeResponse,
  countCodePoints,
  validateSubmission,
  ExerciseError,
  MAX_CODE_POINTS,
} from "@/lib/exercise";

/*
 * AC-031 — exercise validation boundaries.
 *
 * "Submit whitespace-only, confirmation false, 2000 code points, and 2001 code
 * points: first two reject; 2000 accepts with confirmation; 2001 rejects
 * consistently in UI/API/DB."
 *
 * The "consistently" is the point. tests/integration/exercise.test.ts sends the
 * same four bodies at the database to prove it agrees with what is asserted
 * here.
 */

const ok = { response: "A workplace task with synthetic details.", confirmed: true };

describe("AC-031 the four boundary submissions", () => {
  it("rejects whitespace only, including Unicode whitespace", () => {
    for (const blank of ["", "   ", "\n\t ", " 　", "  "]) {
      expect(() => validateSubmission({ response: blank, confirmed: true })).toThrow(
        /Write a response/
      );
    }
  });

  it("rejects an unconfirmed response, however good the text is", () => {
    expect(() => validateSubmission({ ...ok, confirmed: false })).toThrow(/Confirm that you/);
  });

  it("accepts exactly 2000 code points with confirmation", () => {
    const text = "a".repeat(MAX_CODE_POINTS);
    expect(validateSubmission({ response: text, confirmed: true })).toBe(text);
  });

  it("rejects 2001 code points", () => {
    expect(() =>
      validateSubmission({ response: "a".repeat(MAX_CODE_POINTS + 1), confirmed: true })
    ).toThrow(/at most 2000 characters/);
  });
});

describe("AC-031 counting is PostgreSQL's, not JavaScript's", () => {
  it("counts an astral character once, where string.length counts two", () => {
    expect("𝄞".length).toBe(2);
    expect(countCodePoints("𝄞")).toBe(1);
  });

  it("accepts 2000 emoji, which UTF-16 would call 4000 units", () => {
    /*
     * The case that makes this file necessary. Validating on string.length
     * would refuse this, and the database — which counts code points — would
     * have accepted it.
     */
    const text = "🙂".repeat(MAX_CODE_POINTS);
    expect(text.length).toBe(MAX_CODE_POINTS * 2);
    expect(countCodePoints(text)).toBe(MAX_CODE_POINTS);
    expect(validateSubmission({ response: text, confirmed: true })).toBe(text);
  });

  it("rejects 2001 emoji", () => {
    expect(() =>
      validateSubmission({ response: "🙂".repeat(MAX_CODE_POINTS + 1), confirmed: true })
    ).toThrow(ExerciseError);
  });
});

describe("AC-031 normalisation happens before counting", () => {
  it("composes to NFC, so the two spellings of a letter are one character", () => {
    const decomposed = "é"; // e + combining acute
    const composed = "é";
    expect(decomposed).not.toBe(composed);
    expect(normalizeResponse(decomposed)).toBe(composed);
    expect(countCodePoints(normalizeResponse(decomposed))).toBe(1);
  });

  it("lets a decomposed 2000-character response through by composing it first", () => {
    // 2000 characters, 4000 code points before normalisation.
    const text = "é".repeat(MAX_CODE_POINTS);
    expect(countCodePoints(text)).toBe(MAX_CODE_POINTS * 2);
    expect(countCodePoints(validateSubmission({ response: text, confirmed: true }))).toBe(
      MAX_CODE_POINTS
    );
  });

  it("trims surrounding whitespace but keeps what is inside", () => {
    expect(normalizeResponse("  two  words  ")).toBe("two  words");
    expect(normalizeResponse("　line\nbreak ")).toBe("line\nbreak");
  });

  it("stores the normalised text, not the text as typed", () => {
    expect(validateSubmission({ response: "  spaced  ", confirmed: true })).toBe("spaced");
  });

  it("counts a response whose length is only over the limit before trimming as valid", () => {
    const text = " ".repeat(50) + "a".repeat(MAX_CODE_POINTS) + " ".repeat(50);
    expect(validateSubmission({ response: text, confirmed: true })).toHaveLength(MAX_CODE_POINTS);
  });
});

describe("AC-031 the error names its field", () => {
  it("points at response or at confirmed, so a form can show it in place", () => {
    try {
      validateSubmission({ response: " ", confirmed: true });
    } catch (err) {
      expect((err as ExerciseError).path).toBe("response");
      expect((err as ExerciseError).code).toBe("VALIDATION_ERROR");
    }
    try {
      validateSubmission({ ...ok, confirmed: false });
    } catch (err) {
      expect((err as ExerciseError).path).toBe("confirmed");
    }
  });
});

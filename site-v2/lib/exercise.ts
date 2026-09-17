/*
 * Short-response exercise text: normalisation and validation.
 *
 * spec/03: "Normalize exercise text to NFC and trim Unicode whitespace in
 * application and handler-equivalent validation. Count Unicode code points
 * consistently with PostgreSQL char_length, not JavaScript UTF-16 string
 * length. Allow 1–2,000, confirmation=true."
 *
 * The counting rule is the whole reason this file exists. JavaScript's
 * `"👩‍💻".length` is 5 and Postgres's char_length is 3, so a response near the
 * limit would be accepted by one and refused by the other — the browser would
 * show a valid form and the database would reject the save.
 */

export const MAX_CODE_POINTS = 2000;

export class ExerciseError extends Error {
  constructor(
    readonly code: "VALIDATION_ERROR",
    message: string,
    readonly path: string
  ) {
    super(message);
    this.name = "ExerciseError";
  }
}

/*
 * Unicode whitespace, expressed as the property itself rather than a list of
 * escapes. \p{White_Space} is every character Unicode calls whitespace — the
 * no-break space, the ideographic space, the line and paragraph separators —
 * which is what "trim Unicode whitespace" asks for, and is comparable by
 * inspection with Postgres's own btrim in the schema's CHECK.
 */
const SURROUNDING_WHITESPACE = /^\p{White_Space}+|\p{White_Space}+$/gu;

/** NFC, then Unicode-trimmed. What is validated and what is stored. */
export function normalizeResponse(raw: string): string {
  return raw.normalize("NFC").replace(SURROUNDING_WHITESPACE, "");
}

/**
 * Code points, the way PostgreSQL's char_length counts them. The spread
 * iterates by code point rather than UTF-16 unit, so an emoji counts once and
 * not twice.
 */
export function countCodePoints(text: string): number {
  return [...text].length;
}

export interface ExerciseSubmission {
  response: string;
  confirmed: boolean;
}

/**
 * Everything the form, the route and the database agree on. Returns the
 * normalised text to save; throws VALIDATION_ERROR (422) otherwise.
 */
export function validateSubmission(input: ExerciseSubmission): string {
  const response = normalizeResponse(input.response ?? "");

  if (response.length === 0) {
    throw new ExerciseError("VALIDATION_ERROR", "Write a response before confirming.", "response");
  }
  const length = countCodePoints(response);
  if (length > MAX_CODE_POINTS) {
    throw new ExerciseError(
      "VALIDATION_ERROR",
      `A response may be at most ${MAX_CODE_POINTS} characters; this one is ${length}.`,
      "response"
    );
  }
  if (input.confirmed !== true) {
    throw new ExerciseError(
      "VALIDATION_ERROR",
      "Confirm that you completed the exercise.",
      "confirmed"
    );
  }
  return response;
}

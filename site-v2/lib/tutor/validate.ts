import { z } from "zod";

/*
 * The model's answer, checked before anybody sees it.
 *
 * spec/05: "Validate source_ids are a unique subset of retrieved IDs and <=6.
 * For explanation/example require at least one valid source; unsupported may
 * have none. Invalid IDs, missing required citations, refusal, incomplete
 * output or invalid JSON produce failed request with TUTOR_OUTPUT_INVALID and
 * no invented repair."
 *
 * "No invented repair" is the rule that shapes this file. Every tempting
 * recovery — dropping the ids that do not exist, keeping an explanation with
 * no citation, treating a refusal as an unsupported answer — would produce
 * something that looks like a good answer and is not the one the model gave.
 * A failure the learner can retry is honest; a repaired answer is not.
 */

export const MAX_CITATIONS = 6;

/** The structured output schema from spec/05, verbatim in shape. */
export const TUTOR_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answer", "mode", "source_ids"],
  properties: {
    answer: { type: "string" },
    mode: { type: "string", enum: ["explanation", "example", "unsupported"] },
    source_ids: { type: "array", items: { type: "string" } },
  },
} as const;

export const tutorOutputSchema = z
  .object({
    answer: z.string(),
    mode: z.enum(["explanation", "example", "unsupported"]),
    source_ids: z.array(z.string()),
  })
  .strict();

export type TutorOutput = z.infer<typeof tutorOutputSchema>;

export class TutorOutputError extends Error {
  readonly code = "TUTOR_OUTPUT_INVALID";
  constructor(readonly reason: string) {
    super(`The tutor's answer was not usable: ${reason}`);
    this.name = "TutorOutputError";
  }
}

/**
 * Parses and validates one model response against the ids that were actually
 * retrieved. Throws TutorOutputError; never returns a partially repaired
 * answer.
 */
export function validateTutorOutput(raw: unknown, retrievedIds: readonly string[]): TutorOutput {
  const parsed = tutorOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new TutorOutputError(parsed.error.issues[0]?.message ?? "it did not match the schema");
  }
  const output = parsed.data;

  if (output.answer.trim().length === 0) {
    throw new TutorOutputError("it was empty");
  }

  const ids = output.source_ids;
  if (ids.length > MAX_CITATIONS) {
    throw new TutorOutputError(`it cited ${ids.length} sources, and at most ${MAX_CITATIONS} are allowed`);
  }
  if (new Set(ids).size !== ids.length) {
    throw new TutorOutputError("it cited the same source twice");
  }

  const allowed = new Set(retrievedIds);
  const invented = ids.filter((id) => !allowed.has(id));
  if (invented.length > 0) {
    // The important one. A citation to a source that was never supplied is an
    // invented reference, and dropping it quietly would leave a claim standing
    // with nothing behind it.
    throw new TutorOutputError(`it cited a source that was never supplied: ${invented[0]}`);
  }

  if (output.mode !== "unsupported" && ids.length === 0) {
    throw new TutorOutputError(`a ${output.mode} must cite at least one source`);
  }

  return output;
}

/*
 * The model writes Markdown, and Markdown can carry a link, an image or raw
 * HTML. spec/05: "model never supplies executable HTML or external links.
 * Sanitize answer Markdown."
 *
 * Rather than parse Markdown and try to decide which constructs are safe, the
 * answer is reduced to text: the tutor explains and gives examples, and needs
 * emphasis, lists and paragraphs — none of which this removes. Source links
 * are built by us, from our own ids, and rendered beside the answer.
 */
export function sanitizeAnswer(answer: string): string {
  return (
    answer
      // An HTML tag becomes its own text, so nothing is silently swallowed.
      .replace(/<[^>]*>/g, "")
      // A Markdown image becomes its alt text.
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      // A Markdown link becomes its label; the destination is discarded.
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      // A bare URL is not a link anybody asked for.
      .replace(/\bhttps?:\/\/\S+/gi, "[link removed]")
      .replace(/\bjavascript:\S*/gi, "[link removed]")
      .replace(/\bdata:\S*/gi, "[link removed]")
      .trim()
  );
}

/** spec/04: "Mark examples 'Illustrative example.'" */
export const ILLUSTRATIVE_LABEL = "Illustrative example.";

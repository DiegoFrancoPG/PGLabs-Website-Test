import { z } from "zod";
import { callRpc, RpcError } from "@/lib/rpc";
import { serviceClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import {
  assemblePrompt,
  byteLength,
  UNSUPPORTED_ANSWER,
  type TutorContext,
} from "@/lib/tutor/prompt";
import { sanitizeAnswer, TutorOutputError, validateTutorOutput } from "@/lib/tutor/validate";
import {
  tutorProviderAsync,
  TutorNotConfiguredError,
  TutorProviderError,
  MAX_OUTPUT_TOKENS,
  type TutorProvider,
} from "@/lib/tutor/provider";

/*
 * Asking the tutor, in three steps that are deliberately separate:
 *
 *   1. ask_tutor reserves — under the caller's own identity, inside one
 *      database transaction that takes the locks, spends the quota and records
 *      what the call may cost.
 *   2. the provider is called — outside any transaction, because a database
 *      transaction must never wait on a network round trip.
 *   3. tutor.finish settles — through the service-role job dispatcher, which
 *      acts only on a request id step 1 already authorized.
 *
 * If the process dies between 2 and 3 the reservation stays, and the request
 * is swept to failed by tutor.reap. spec/05: "Never release unknown usage
 * simply because frontend disconnected."
 */

export const tutorCreateSchema = z
  .object({
    enrollment_id: z.string().uuid(),
    class_id: z.string().uuid(),
    session_id: z.string().uuid().nullable(),
    question: z.string().min(1).max(2000),
    intent: z.enum(["explanation", "example"]),
  })
  .strict();

export const citationSchema = z.object({
  source_id: z.string().uuid(),
  class_id: z.string().uuid(),
  title: z.string(),
  href: z.string(),
});

export const tutorAnswerSchema = z.object({
  request_id: z.string().uuid(),
  session_id: z.string().uuid(),
  status: z.enum(["pending", "completed", "failed"]),
  answer: z.string().nullable(),
  mode: z.enum(["explanation", "example", "unsupported"]).nullable(),
  citations: z.array(citationSchema).max(6),
  error_code: z.string().nullable(),
  question: z.string(),
  class_id: z.string().uuid(),
});

export type TutorAnswer = z.infer<typeof tutorAnswerSchema>;

const reservationSchema = z.discriminatedUnion("replay", [
  z.object({ replay: z.literal(true), answer: tutorAnswerSchema }),
  z.object({
    replay: z.literal(false),
    request_id: z.string().uuid(),
    session_id: z.string().uuid(),
    reserved_usd: z.union([z.number(), z.string()]).transform(Number),
    context: z.custom<TutorContext>(),
  }),
]);

/** What a settled call costs, at the configured rates. */
export function costOf(inputTokens: number, outputTokens: number): number {
  const env = serverEnv();
  return (
    (inputTokens / 1_000_000) * env.TUTOR_INPUT_USD_PER_MILLION +
    (outputTokens / 1_000_000) * env.TUTOR_OUTPUT_USD_PER_MILLION
  );
}

async function finish(payload: Record<string, unknown>): Promise<void> {
  const supabase = serviceClient();
  const { error } = await supabase.rpc("pglearn_job", { job: "tutor.finish", payload });
  if (error) {
    // The request stays pending and the reservation stays held; tutor.reap
    // resolves it. Losing the settlement must never lose the money.
    console.error("[tutor] settlement failed", { code: error.code, message: error.message });
  }
}

export async function askTutor(
  body: z.infer<typeof tutorCreateSchema>,
  requestId: string,
  configured?: TutorProvider | null
): Promise<TutorAnswer> {
  const env = serverEnv();
  const provider = configured === undefined ? await tutorProviderAsync() : configured;

  /*
   * The byte bound is computed before reserving, because the reservation is
   * based on it: spec/05's "conservative input token upper bound equal to
   * assembled UTF-8 byte count". The real assembly happens after the context
   * comes back, and can only be smaller.
   */
  const reservation = reservationSchema.parse(
    await callRpc("ask_tutor", {
      request_id: requestId,
      ...body,
      input_bytes: 24_000,
      input_rate: env.TUTOR_INPUT_USD_PER_MILLION,
      output_rate: env.TUTOR_OUTPUT_USD_PER_MILLION,
      budget: env.TUTOR_MONTHLY_BUDGET_USD,
    })
  );

  // A replay: the answer that was already produced, with no second call.
  if (reservation.replay) return reservation.answer;

  const prompt = assemblePrompt(reservation.context, body.question);

  /*
   * "Empty authorized sources returns a deterministic unsupported answer
   * without invoking model." The reservation is released as not_invoked,
   * because here there is no uncertainty: nothing was sent.
   */
  if (prompt.unsupported) {
    await finish({
      request_id: reservation.request_id,
      outcome: "not_invoked",
      answer: UNSUPPORTED_ANSWER,
    });
    return getTutorRequest(reservation.request_id);
  }

  if (!provider) {
    await finish({
      request_id: reservation.request_id,
      outcome: "failed",
      error_code: "NOT_CONFIGURED",
    });
    throw new TutorNotConfiguredError();
  }

  try {
    const result = await provider.answer({
      instructions: prompt.instructions,
      question: prompt.question,
      history: prompt.history,
      sources: prompt.sources,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });

    // Checked again here against what was actually assembled: the provider
    // validated the shape, but only this layer knows which sources survived
    // the byte budget.
    const output = validateTutorOutput(
      { answer: result.answer, mode: result.mode, source_ids: result.sourceIds },
      prompt.sources.map((source) => source.id)
    );

    await finish({
      request_id: reservation.request_id,
      outcome: "completed",
      answer: sanitizeAnswer(output.answer),
      mode: output.mode,
      citations: output.source_ids,
      input_tokens: result.inputTokens,
      output_tokens: result.outputTokens,
      actual_usd: costOf(result.inputTokens, result.outputTokens),
    });
  } catch (err) {
    /*
     * A refusal, an invalid answer or an unreachable provider all end the same
     * way for the learner: a failed request they may retry. The usage is only
     * settled when it is KNOWN; otherwise the reservation is retained as
     * uncertain, because the call may have cost money we cannot see.
     */
    const code =
      err instanceof TutorOutputError
        ? "TUTOR_OUTPUT_INVALID"
        : err instanceof TutorProviderError
          ? "PROVIDER_UNAVAILABLE"
          : "TUTOR_OUTPUT_INVALID";
    console.error("[tutor] request failed", { code, message: (err as Error).message });
    await finish({ request_id: reservation.request_id, outcome: "failed", error_code: code });
  }

  return getTutorRequest(reservation.request_id);
}

export async function getTutorRequest(requestId: string): Promise<TutorAnswer> {
  return tutorAnswerSchema.parse(await callRpc("get_tutor_request", { request_id: requestId }));
}

export async function listTutorHistory(sessionId: string, limit = 20) {
  return z
    .object({ items: z.array(tutorAnswerSchema), next_cursor: z.string().nullable() })
    .parse(await callRpc("list_tutor_history", { session_id: sessionId, limit }));
}

export { RpcError, TutorNotConfiguredError };

/** The byte length of a question, for the reservation bound. */
export { byteLength };

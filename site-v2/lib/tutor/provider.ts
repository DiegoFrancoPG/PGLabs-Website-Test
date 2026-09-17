import { serverEnv } from "@/lib/env";
import { TUTOR_OUTPUT_SCHEMA, validateTutorOutput, type TutorOutput } from "@/lib/tutor/validate";
import { renderSource, type TutorExchange, type TutorSource } from "@/lib/tutor/prompt";

/*
 * The tutor model adapter.
 *
 * spec/05 declares the internal contract callers depend on:
 *   TutorProvider.answer({instructions,question,history,sources,maxOutputTokens})
 *     : Promise<{answer,mode,sourceIds,inputTokens,outputTokens}>
 *   "Reject malformed/refused/incomplete structured output; never pass
 *   arbitrary tool definitions."
 *
 * Nothing above this file knows it is OpenAI. ADR-13 makes the Responses API
 * the default and the model configurable, so a change of model — or of vendor
 * — is a change to this file and the environment, not to the contracts.
 */

export const MAX_OUTPUT_TOKENS = 2048;
export const REQUEST_TIMEOUT_MS = 45_000;

export interface TutorRequest {
  instructions: string;
  question: string;
  history: TutorExchange[];
  sources: TutorSource[];
  maxOutputTokens?: number;
}

export interface TutorResult {
  answer: string;
  mode: TutorOutput["mode"];
  sourceIds: string[];
  inputTokens: number;
  outputTokens: number;
}

export interface TutorProvider {
  answer(request: TutorRequest): Promise<TutorResult>;
}

export class TutorNotConfiguredError extends Error {
  readonly code = "NOT_CONFIGURED";
  constructor() {
    super("The tutor is not configured.");
    this.name = "TutorNotConfiguredError";
  }
}

export class TutorProviderError extends Error {
  readonly code = "PROVIDER_UNAVAILABLE";
  constructor(message: string) {
    super(message);
    this.name = "TutorProviderError";
  }
}

/**
 * The single user message: sources, then the conversation, then the question.
 *
 * All of it is user-role content. The teaching rules go in `instructions`,
 * which the Responses API keeps as system-level, so course text arriving in a
 * source cannot be mistaken for an instruction — the separation spec/05 asks
 * for is structural, not a matter of wording.
 */
export function buildInput(request: TutorRequest): string {
  const parts: string[] = [];

  parts.push("Course sources you may cite:");
  for (const source of request.sources) parts.push(renderSource(source));

  if (request.history.length > 0) {
    parts.push("\nEarlier in this conversation:");
    for (const exchange of request.history) {
      parts.push(`Learner: ${exchange.question}\nTutor: ${exchange.answer}`);
    }
  }

  parts.push(`\nThe learner asks:\n${request.question}`);
  return parts.join("\n\n");
}

/*
 * The OpenAI Responses adapter.
 *
 * Deliberately a plain fetch rather than the SDK: this is one POST with a
 * fixed body, and the SDK's surface is larger than the use. spec/05 warns
 * against "unsupported generation parameters such as temperature without
 * verifying model support" — none are sent here beyond what the model page
 * documents.
 */
export class OpenAiTutorProvider implements TutorProvider {
  constructor(
    private readonly apiKey: string,
    private readonly model: string,
    private readonly timeoutMs = REQUEST_TIMEOUT_MS
  ) {}

  async answer(request: TutorRequest): Promise<TutorResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          instructions: request.instructions,
          input: buildInput(request),
          // spec/05: store:false, reasoning effort low, 2,048 output tokens,
          // strict structured output. No tools of any kind are offered.
          store: false,
          reasoning: { effort: "low" },
          max_output_tokens: request.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
          text: {
            format: {
              type: "json_schema",
              name: "tutor_answer",
              strict: true,
              schema: TUTOR_OUTPUT_SCHEMA,
            },
          },
        }),
      });
    } catch (err) {
      // A timeout is indistinguishable from a network failure from here, and
      // both mean the same thing to the caller: no answer, and a reservation
      // that must be kept rather than released.
      throw new TutorProviderError(
        (err as Error).name === "AbortError" ? "the model did not answer in time" : "the model could not be reached"
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // The provider's body may carry account details; it is logged, never returned.
      const body = await response.text().catch(() => "");
      console.error("[tutor] provider error", { status: response.status, body: body.slice(0, 500) });
      throw new TutorProviderError("the model could not be reached");
    }

    const payload = (await response.json()) as {
      status?: string;
      incomplete_details?: { reason?: string };
      output?: { type?: string; content?: { type?: string; text?: string }[] }[];
      output_text?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    const inputTokens = payload.usage?.input_tokens ?? 0;
    const outputTokens = payload.usage?.output_tokens ?? 0;

    /*
     * "Reject malformed/refused/incomplete structured output." An incomplete
     * response — the token limit reached mid-answer — is not a short answer,
     * it is a truncated one, and must not be shown.
     */
    if (payload.status === "incomplete") {
      throw new TutorProviderError(
        `the model stopped early (${payload.incomplete_details?.reason ?? "incomplete"})`
      );
    }

    const message = payload.output?.find((item) => item.type === "message");
    const refusal = message?.content?.find((part) => part.type === "refusal");
    if (refusal) throw new TutorProviderError("the model declined to answer");

    const text =
      message?.content?.find((part) => part.type === "output_text")?.text ?? payload.output_text;
    if (!text) throw new TutorProviderError("the model returned no answer");

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new TutorProviderError("the model's answer was not valid JSON");
    }

    // Structural validation against the schema only. Checking the citations
    // against what was retrieved is the caller's job, because only the caller
    // knows what it supplied.
    const output = validateTutorOutput(parsed, extractIds(request.sources));

    return {
      answer: output.answer,
      mode: output.mode,
      sourceIds: output.source_ids,
      inputTokens,
      outputTokens,
    };
  }
}

function extractIds(sources: readonly TutorSource[]): string[] {
  return sources.map((source) => source.id);
}

/**
 * The configured provider, or null when no key is set.
 *
 * PGLEARN_USE_FIXTURES substitutes a stub that answers without a model. It is
 * the same flag assertCoreConfigured() refuses to boot with in pilot or
 * production, because spec/05 forbids mock providers there — one switch, one
 * guard, rather than a second mechanism nothing checks.
 */
export async function tutorProviderAsync(): Promise<TutorProvider | null> {
  if (process.env.PGLEARN_USE_FIXTURES && serverEnv().APP_ENV !== "production") {
    const { StubTutorProvider } = await import("@/lib/tutor/stub");
    return new StubTutorProvider();
  }
  const key = serverEnv().OPENAI_API_KEY;
  if (!key) return null;
  return new OpenAiTutorProvider(key, serverEnv().OPENAI_MODEL);
}

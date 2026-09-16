import type { TutorProvider, TutorRequest, TutorResult } from "@/lib/tutor/provider";
import { TutorProviderError } from "@/lib/tutor/provider";

/*
 * A tutor that answers without a model, for AC-067.
 *
 * spec/05 forbids mock providers in production — "Production fixtures/mock
 * providers are forbidden" — and `assertCoreConfigured` refuses to boot a
 * pilot or production deployment with PGLEARN_USE_FIXTURES set. This is
 * reachable only behind that same flag, which is why it uses it rather than
 * inventing a second switch that nothing checks.
 *
 * What it produces is decided by the question, so one e2e run can exercise a
 * good answer, an unsupported one, an invalid one and a provider failure
 * without needing four different mechanisms.
 */
export class StubTutorProvider implements TutorProvider {
  async answer(request: TutorRequest): Promise<TutorResult> {
    const question = request.question.toLowerCase();
    const firstSource = request.sources[0]?.id;

    if (question.includes("stub:fail")) {
      throw new TutorProviderError("the stub was asked to fail");
    }

    if (question.includes("stub:invalid")) {
      // A citation to a source that was never supplied: the case AC-041 cares
      // about, which must fail visibly rather than be quietly repaired.
      return {
        answer: "An answer citing something that does not exist.",
        mode: "explanation",
        sourceIds: ["99999999-9999-4999-8999-999999999999"],
        inputTokens: 100,
        outputTokens: 50,
      };
    }

    if (question.includes("stub:unsupported")) {
      return {
        answer: "That is outside the material for this course.",
        mode: "unsupported",
        sourceIds: [],
        inputTokens: 100,
        outputTokens: 20,
      };
    }

    const example = question.includes("example");
    return {
      answer: example
        ? "Imagine a colleague drafting a customer summary. They name the audience, the length and the tone before asking."
        : "Being specific means naming the task, the audience and the output you want.",
      mode: example ? "example" : "explanation",
      sourceIds: firstSource ? [firstSource] : [],
      inputTokens: 900,
      outputTokens: 120,
    };
  }
}

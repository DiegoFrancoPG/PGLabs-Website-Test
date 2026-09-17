import { askTutor, tutorCreateSchema } from "@/features/tutor/tutor";
import { TutorNotConfiguredError } from "@/lib/tutor/provider";
import { mutateRoute } from "@/lib/route";
import { jsonError, resolveRequestId } from "@/lib/http";

/*
 * operationId ask_tutor.
 *
 * spec/05: "Use Idempotency-Key as tutor request ID" — so the header is not
 * merely a replay guard here, it IS the request's identity, and the GET below
 * is addressed by the same value.
 *
 * maxDuration 60: the model has 45 seconds, and the remainder is for the
 * settlement that must follow it.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const requestId = resolveRequestId(request);
  try {
    return await mutateRoute(request, tutorCreateSchema, ({ body, requestId: key }) =>
      askTutor(body, key)
    );
  } catch (err) {
    if (err instanceof TutorNotConfiguredError) {
      return jsonError("NOT_CONFIGURED", "The tutor is not available yet.", requestId);
    }
    throw err;
  }
}

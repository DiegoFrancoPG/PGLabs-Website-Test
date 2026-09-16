import { verifyEmailWebhook, EmailNotConfiguredError } from "@/lib/email/provider";
import { serviceClient } from "@/lib/supabase/server";
import { jsonError, jsonOk, resolveRequestId } from "@/lib/http";

/*
 * operationId email_webhook.
 *
 * spec/05: "Verify webhook raw body with SDK and `svix-id`, `svix-timestamp`,
 * `svix-signature`; reject invalid signatures with 401 before persisting."
 *
 * Before persisting is the load-bearing phrase. The body is read as raw text
 * and verified before anything reaches the database, so a forged callback
 * cannot mark somebody's mail delivered or leave a record a later
 * reconciliation would trust.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = resolveRequestId(request);

  // Raw, not parsed: the signature is over these exact bytes.
  const rawBody = await request.text();

  let event;
  try {
    event = await verifyEmailWebhook(rawBody, request.headers);
  } catch (err) {
    if (err instanceof EmailNotConfiguredError) {
      return jsonError("NOT_CONFIGURED", "Email callbacks are not configured.", requestId);
    }
    // Nothing is written on the way here, and the reason is not disclosed.
    console.error("[webhook] rejected an unverified email event");
    return jsonError("UNAUTHENTICATED", "The callback could not be verified.", requestId);
  }

  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("pglearn_job", {
    job: "email.event",
    payload: {
      provider_event_id: event.providerEventId,
      provider_email_id: event.providerEmailId,
      type: event.type,
    },
  });

  if (error) {
    console.error("[webhook] could not record a verified event", { code: error.code });
    return jsonError("CONFLICT", "The callback could not be recorded.", requestId);
  }

  return jsonOk(data, requestId);
}

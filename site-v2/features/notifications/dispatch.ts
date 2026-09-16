import { serviceClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { renderEmail, type EmailKind, type TemplateContext } from "@/lib/email/templates";
import {
  emailProvider,
  maySendTo,
  EmailRejected,
  EmailUncertain,
  type EmailProvider,
} from "@/lib/email/provider";

/*
 * Sending what the scheduler planned.
 *
 * The database claims the work, leases it and records the outcome; this walks
 * the claimed batch and talks to the provider. The split matters: a claim is a
 * transaction, a send is a network call, and the two must not be the same
 * thing.
 *
 * spec/03: "provider concurrency max 3" — so a batch of twenty does not open
 * twenty connections to the provider at once.
 */

const CONCURRENCY = 3;

interface ClaimedMessage {
  id: string;
  kind: EmailKind;
  event_key: string;
  recipient_email: string;
  payload: Record<string, unknown>;
  attempts: number;
  first_attempt_at: string;
  enrollment_id: string | null;
  user_id: string;
}

async function job<T>(name: string, payload: Record<string, unknown> = {}): Promise<T> {
  const supabase = serviceClient();
  const { data, error } = await supabase.rpc("pglearn_job", { job: name, payload });
  if (error) throw new Error(`${name} failed: ${error.code ?? ""}`);
  return data as T;
}

/** The context a template needs, taken from what the outbox froze at plan time. */
function contextFor(message: ClaimedMessage, appUrl: string): TemplateContext {
  const payload = message.payload ?? {};
  const dueAt = typeof payload.due_at === "string" ? payload.due_at : undefined;
  const timezone = typeof payload.timezone === "string" ? payload.timezone : "UTC";

  return {
    appUrl,
    // The recipient's own address is the only identity the template needs;
    // spec/05 keeps names and course content out of reminder mail.
    displayName: typeof payload.display_name === "string" ? payload.display_name : "there",
    programTitle: typeof payload.program_title === "string" ? payload.program_title : undefined,
    organizationName: typeof payload.organization === "string" ? payload.organization : null,
    dueDate: dueAt
      ? new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: timezone }).format(
          new Date(dueAt)
        )
      : undefined,
    timezone,
    enrollmentId: message.enrollment_id ?? undefined,
    certificateId: typeof payload.certificate_id === "string" ? payload.certificate_id : undefined,
    actionUrl: typeof payload.action_url === "string" ? payload.action_url : undefined,
  };
}

/**
 * One pass: recover expired leases, plan what is due, claim a batch and send it.
 *
 * Returns counts only. Nothing here returns an address, a subject or a link —
 * this runs behind a cron secret and its output goes into logs.
 */
export async function dispatchNotifications(
  now?: string,
  provider: EmailProvider | null = emailProvider()
): Promise<{ planned: number; claimed: number; sent: number; failed: number; skipped: number }> {
  const appUrl = serverEnv().NEXT_PUBLIC_APP_URL;

  await job("reminders.recover", now ? { now } : {});
  const planned = await job<{ planned: number }>("reminders.plan", now ? { now } : {});
  const claim = await job<{ claimed: ClaimedMessage[]; suppressed: number }>(
    "reminders.claim",
    now ? { now } : {}
  );

  const messages = claim.claimed ?? [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

  // Three at a time, as spec/03 requires.
  for (let start = 0; start < messages.length; start += CONCURRENCY) {
    const slice = messages.slice(start, start + CONCURRENCY);
    await Promise.all(
      slice.map(async (message) => {
        if (!provider) {
          // Nothing configured: the message stays claimed and is retried once
          // a provider exists. It is not a failure of the message.
          await job("reminders.finish", {
            id: message.id, outcome: "unknown", error: "email is not configured",
          });
          skipped += 1;
          return;
        }

        if (!maySendTo(message.recipient_email)) {
          /*
           * Outside the controlled allowlist. This is a deliberate refusal, not
           * a provider failure, so it is recorded as suppressed rather than
           * retried for ever.
           */
          await job("reminders.finish", {
            id: message.id, outcome: "rejected", error: "recipient is not in EMAIL_TEST_ALLOWLIST",
          });
          skipped += 1;
          return;
        }

        const content = renderEmail(message.kind, contextFor(message, appUrl));
        try {
          const { providerId } = await provider.send({
            // The outbox row's uuid IS the provider's Idempotency-Key, so a
            // retry inside the 24-hour window cannot produce a second email.
            idempotencyKey: message.id,
            to: message.recipient_email,
            subject: content.subject,
            html: content.html,
            text: content.text,
          });
          await job("reminders.finish", {
            id: message.id, outcome: "accepted", provider_id: providerId,
          });
          sent += 1;
        } catch (err) {
          const definitive = err instanceof EmailRejected;
          if (!definitive && !(err instanceof EmailUncertain)) {
            console.error("[email] unexpected send failure", (err as Error).name);
          }
          await job("reminders.finish", {
            id: message.id,
            outcome: definitive ? "rejected" : "unknown",
            error: (err as Error).message,
          });
          failed += 1;
        }
      })
    );
  }

  // Callbacks that overtook the provider id we have just saved.
  await job("email.reconcile", now ? { now } : {});

  return {
    planned: Number(planned.planned ?? 0),
    claimed: messages.length,
    sent,
    failed,
    skipped,
  };
}

import { createPublicKey, timingSafeEqual, verify } from "node:crypto";
import { serverEnv, emailProviderName } from "@/lib/env";

/*
 * The email provider, as spec/05 declares it:
 *
 *   EmailProvider.send({idempotencyKey,to,subject,html,text}): Promise<{providerId}>
 *   EmailProvider.verifyWebhook(rawBody, headers): ProviderEmailEvent
 *   "Provider errors distinguish definitive rejection from uncertain outcome."
 *
 * That last sentence is the whole design. A 422 from the provider means the
 * message will never be sent; a timeout means nobody knows. The outbox treats
 * them completely differently — one is failed, the other keeps its daily slot
 * and waits for reconciliation — so an adapter that collapsed them into
 * "error" would quietly send somebody two reminders, or none.
 */

export interface EmailMessage {
  idempotencyKey: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export class EmailRejected extends Error {
  readonly definitive = true;
  constructor(message: string) {
    super(message);
    this.name = "EmailRejected";
  }
}

export class EmailUncertain extends Error {
  readonly definitive = false;
  constructor(message: string) {
    super(message);
    this.name = "EmailUncertain";
  }
}

export class EmailNotConfiguredError extends Error {
  readonly code = "NOT_CONFIGURED";
  constructor() {
    super("Email is not configured.");
    this.name = "EmailNotConfiguredError";
  }
}

export interface ProviderEmailEvent {
  providerEventId: string;
  providerEmailId: string;
  /** Normalised from the provider's own vocabulary. */
  type: "accepted" | "delivered" | "bounced" | "complained" | "failed";
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<{ providerId: string }>;
}

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Resend, over its REST API.
 *
 * The outbox row's uuid is the Idempotency-Key, which is why a retry must
 * never mint a new one: Resend deduplicates on it for 24 hours, and the
 * behavioural cutoff is 23, so a retry inside the window can never produce a
 * second email (spec/05).
 */
export class ResendEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly timeoutMs = REQUEST_TIMEOUT_MS
  ) {}

  async send(message: EmailMessage): Promise<{ providerId: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
    } catch (err) {
      // A timeout or a dropped connection is NOT proof the message was not
      // sent. spec/03: "A timeout is not proof of failure."
      throw new EmailUncertain(
        (err as Error).name === "AbortError" ? "the provider did not answer in time" : "the provider could not be reached"
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      const body = (await response.json()) as { id?: string };
      if (!body.id) throw new EmailUncertain("the provider accepted without an id");
      return { providerId: body.id };
    }

    const detail = await response.text().catch(() => "");
    if (isDefinitiveRejection(response.status)) {
      throw new EmailRejected(`the provider rejected the message (${response.status})`);
    }
    console.error("[email] provider error", { status: response.status, detail: detail.slice(0, 300) });
    throw new EmailUncertain(`the provider returned ${response.status}`);
  }
}

/**
 * The adapter's own reading of a response status, shared by both providers.
 *
 * 4xx other than 429 is the provider saying no: a malformed address, a blocked
 * domain, a rejected sender. Those can be recorded as failed. 429 and 5xx say
 * nothing about whether the message went out.
 */
function isDefinitiveRejection(status: number): boolean {
  return status >= 400 && status < 500 && status !== 429;
}

/**
 * SendGrid, over its v3 Web API (D-23).
 *
 * Unlike Resend, SendGrid has no idempotency key: a retry after an uncertain
 * outcome can deliver the message a second time. The outbox still retries an
 * unknown outcome, because a reminder or invitation that never arrives is the
 * worse failure; HANDOFF.md D-23 records the trade. The outbox id travels in
 * `custom_args`, so a duplicate can be traced to its row in SendGrid's
 * activity feed.
 *
 * Click, open and subscription tracking are switched off: tracking would
 * rewrite every link through SendGrid's domain, and the templates promise
 * links only into the application (tests/unit/email.test.ts).
 */
export class SendGridEmailProvider implements EmailProvider {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly timeoutMs = REQUEST_TIMEOUT_MS
  ) {}

  async send(message: EmailMessage): Promise<{ providerId: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(sendGridBody(message, this.from)),
      });
    } catch (err) {
      throw new EmailUncertain(
        (err as Error).name === "AbortError" ? "the provider did not answer in time" : "the provider could not be reached"
      );
    } finally {
      clearTimeout(timer);
    }

    if (response.ok) {
      // 202 with an empty body; the id that callbacks carry is in this header.
      const id = response.headers.get("x-message-id");
      if (!id) throw new EmailUncertain("the provider accepted without an id");
      return { providerId: id };
    }

    const detail = await response.text().catch(() => "");
    if (isDefinitiveRejection(response.status)) {
      throw new EmailRejected(`the provider rejected the message (${response.status})`);
    }
    console.error("[email] provider error", { status: response.status, detail: detail.slice(0, 300) });
    throw new EmailUncertain(`the provider returned ${response.status}`);
  }
}

/** The v3 mail/send body for one message. Exported for its test. */
export function sendGridBody(message: EmailMessage, from: string) {
  return {
    personalizations: [{ to: [{ email: message.to }] }],
    from: { email: from },
    subject: message.subject,
    // SendGrid requires text/plain before text/html.
    content: [
      { type: "text/plain", value: message.text },
      { type: "text/html", value: message.html },
    ],
    custom_args: { outbox_id: message.idempotencyKey },
    tracking_settings: {
      click_tracking: { enable: false, enable_text: false },
      open_tracking: { enable: false },
      subscription_tracking: { enable: false },
    },
  };
}

/**
 * Verifies a SendGrid Signed Event Webhook and returns the events it carries.
 *
 * SendGrid signs the timestamp header followed by the raw body with ECDSA
 * (P-256, SHA-256) and sends the DER signature in base64. As with Resend,
 * nothing is parsed, let alone written, until the signature holds.
 *
 * There is no freshness window: SendGrid documents none, and a replayed
 * authentic batch changes nothing, because every event is deduplicated by its
 * `sg_event_id` (M21).
 *
 * One POST carries a batch. Engagement events (open, click, unsubscribe) and
 * `deferred`, which SendGrid follows with a final delivered, bounce or
 * dropped, are left out rather than recorded as failures.
 */
export function verifySendGridWebhook(rawBody: string, headers: Headers): ProviderEmailEvent[] {
  const publicKey = serverEnv().SENDGRID_WEBHOOK_PUBLIC_KEY;
  if (!publicKey) throw new EmailNotConfiguredError();

  const signature = headers.get("x-twilio-email-event-webhook-signature");
  const timestamp = headers.get("x-twilio-email-event-webhook-timestamp");
  if (!signature || !timestamp) throw new Error("the webhook carried no signature");

  const key = createPublicKey({ key: Buffer.from(publicKey, "base64"), format: "der", type: "spki" });
  const valid = verify(
    "sha256",
    Buffer.from(timestamp + rawBody, "utf8"),
    key,
    Buffer.from(signature, "base64")
  );
  if (!valid) throw new Error("the webhook signature did not verify");

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new Error("the webhook body was not valid JSON");
  }
  if (!Array.isArray(payload)) throw new Error("the webhook body was not a batch");

  const events: ProviderEmailEvent[] = [];
  for (const raw of payload as Array<Record<string, unknown>>) {
    const type = normalizeSendGridEventType(typeof raw.event === "string" ? raw.event : "");
    if (!type) continue;
    if (typeof raw.sg_event_id !== "string" || !raw.sg_event_id) {
      throw new Error("a webhook event carried no event id");
    }
    events.push({
      providerEventId: raw.sg_event_id,
      providerEmailId: sendGridMessageId(typeof raw.sg_message_id === "string" ? raw.sg_message_id : ""),
      type,
    });
  }
  return events;
}

/**
 * The X-Message-Id the send saved, from a callback's sg_message_id. SendGrid
 * appends a dot and its own routing suffix to the id it returned
 * ("<x-message-id>.filterdrecv-…"); the outbox stores the bare id.
 */
export function sendGridMessageId(sgMessageId: string): string {
  const dot = sgMessageId.indexOf(".");
  return dot === -1 ? sgMessageId : sgMessageId.slice(0, dot);
}

/** SendGrid's vocabulary, or null for an event the outbox does not track. */
export function normalizeSendGridEventType(event: string): ProviderEmailEvent["type"] | null {
  switch (event) {
    case "processed":
      return "accepted";
    case "delivered":
      return "delivered";
    case "bounce":
      return "bounced";
    case "spamreport":
      return "complained";
    case "dropped":
      return "failed";
    default:
      return null;
  }
}

/**
 * Verifies a Resend (Svix) webhook against the raw body.
 *
 * spec/05: "Verify webhook raw body with SDK and `svix-id`, `svix-timestamp`,
 * `svix-signature`; reject invalid signatures with 401 before persisting."
 *
 * Nothing is written before this returns. A forged callback must not be able
 * to mark somebody's mail delivered, and must not leave a trace that a later
 * reconciliation would trust.
 */
export async function verifyEmailWebhook(
  rawBody: string,
  headers: Headers
): Promise<ProviderEmailEvent> {
  const secret = serverEnv().RESEND_WEBHOOK_SECRET;
  if (!secret) throw new EmailNotConfiguredError();

  const { Webhook } = await import("svix");
  const webhook = new Webhook(secret);

  /*
   * Throws on a bad signature, a missing header, or a timestamp outside the
   * SDK's tolerance. The caller turns that into a 401.
   *
   * The return value is not used: this version of the SDK resolves it to
   * undefined, and in any case verification answers "are these bytes
   * authentic", which is a different question from "what do they say". The
   * body is parsed below, only after it has been proven ours.
   */
  webhook.verify(rawBody, {
    "svix-id": headers.get("svix-id") ?? "",
    "svix-timestamp": headers.get("svix-timestamp") ?? "",
    "svix-signature": headers.get("svix-signature") ?? "",
  });

  let payload: { type?: string; data?: { email_id?: string } };
  try {
    payload = JSON.parse(rawBody) as { type?: string; data?: { email_id?: string } };
  } catch {
    throw new Error("the webhook body was not valid JSON");
  }

  const id = headers.get("svix-id");
  if (!id) throw new Error("the webhook carried no event id");

  return {
    providerEventId: id,
    providerEmailId: payload.data?.email_id ?? "",
    type: normalizeEventType(payload.type ?? ""),
  };
}

/** Resend's vocabulary, reduced to the four outcomes the outbox knows. */
export function normalizeEventType(type: string): ProviderEmailEvent["type"] {
  switch (type) {
    case "email.sent":
      return "accepted";
    case "email.delivered":
      return "delivered";
    case "email.bounced":
      return "bounced";
    case "email.complained":
      return "complained";
    default:
      return "failed";
  }
}

/**
 * Constant-time secret comparison for the scheduler.
 *
 * spec/05: "require `Authorization: Bearer ${CRON_SECRET}` with constant-time
 * comparison". A `===` on a secret leaks its prefix through timing, which is a
 * small leak but an entirely avoidable one.
 */
export function secretMatches(provided: string | null, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which would itself be a
  // timing signal; comparing a fixed-length digest of each avoids that.
  if (a.length !== b.length) {
    // Still do the work, so a wrong length costs the same as a wrong value.
    const padded = Buffer.alloc(Math.max(a.length, b.length));
    const other = Buffer.alloc(Math.max(a.length, b.length));
    a.copy(padded);
    b.copy(other);
    timingSafeEqual(padded, other);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Whether this address may actually be written to.
 *
 * EMAIL_TEST_ALLOWLIST exists so that a development database full of
 * `@example.invalid` fixtures cannot become real mail to a real person during
 * a controlled first send. Empty means no restriction.
 */
export function maySendTo(address: string): boolean {
  const allowlist = serverEnv().EMAIL_TEST_ALLOWLIST;
  if (!allowlist) return true;
  const allowed = allowlist.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(address.toLowerCase());
}

/** The configured provider, or null when the key or sender is missing. */
export function emailProvider(): EmailProvider | null {
  const env = serverEnv();
  switch (emailProviderName(env)) {
    case "sendgrid":
      return new SendGridEmailProvider(env.SENDGRID_API_KEY!, env.EMAIL_FROM!);
    case "resend":
      return new ResendEmailProvider(env.RESEND_API_KEY!, env.EMAIL_FROM!);
    default:
      return null;
  }
}

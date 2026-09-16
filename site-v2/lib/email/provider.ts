import { timingSafeEqual } from "node:crypto";
import { serverEnv } from "@/lib/env";

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
    /*
     * 4xx other than 429 is the provider saying no: a malformed address, a
     * blocked domain, a rejected sender. Those can be recorded as failed.
     * 429 and 5xx say nothing about whether the message went out.
     */
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      throw new EmailRejected(`the provider rejected the message (${response.status})`);
    }
    console.error("[email] provider error", { status: response.status, detail: detail.slice(0, 300) });
    throw new EmailUncertain(`the provider returned ${response.status}`);
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
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return null;
  return new ResendEmailProvider(env.RESEND_API_KEY, env.EMAIL_FROM);
}

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { resetServerEnvCache } from "@/lib/env";
import {
  SendGridEmailProvider,
  EmailRejected,
  EmailUncertain,
  EmailNotConfiguredError,
  sendGridBody,
  sendGridMessageId,
  normalizeSendGridEventType,
  verifySendGridWebhook,
} from "@/lib/email/provider";

/*
 * The SendGrid adapter (D-23): what it sends, how it reads SendGrid's answer,
 * and how it decides a callback is SendGrid's.
 */

const ORIGINAL = { ...process.env };

const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const PUBLIC_KEY_B64 = publicKey.export({ format: "der", type: "spki" }).toString("base64");

beforeEach(() => {
  process.env = {
    ...ORIGINAL,
    NEXT_PUBLIC_APP_URL: "http://localhost:3001",
    NEXT_PUBLIC_SUPABASE_URL: "https://example-ref.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
    SENDGRID_WEBHOOK_PUBLIC_KEY: PUBLIC_KEY_B64,
  };
  resetServerEnvCache();
});
afterEach(() => {
  process.env = { ...ORIGINAL };
  resetServerEnvCache();
  vi.unstubAllGlobals();
});

const message = {
  idempotencyKey: "33333333-3333-4333-8333-333333333333",
  to: "amber@example.test",
  subject: "Keep going",
  html: "<html><body>Hi</body></html>",
  text: "Hi",
};

/** Signs a body the way SendGrid does: ECDSA P-256 over timestamp + body, DER, base64. */
function signedHeaders(body: string, timestamp = "1761200000"): Headers {
  const signature = sign("sha256", Buffer.from(timestamp + body, "utf8"), privateKey).toString("base64");
  return new Headers({
    "X-Twilio-Email-Event-Webhook-Signature": signature,
    "X-Twilio-Email-Event-Webhook-Timestamp": timestamp,
  });
}

const batch = JSON.stringify([
  { event: "processed", sg_event_id: "ev-1", sg_message_id: "abc123.filterdrecv-1.0", email: "a@example.test" },
  { event: "delivered", sg_event_id: "ev-2", sg_message_id: "abc123.filterdrecv-1.1" },
  { event: "open", sg_event_id: "ev-3", sg_message_id: "abc123.filterdrecv-1.2" },
  { event: "deferred", sg_event_id: "ev-4", sg_message_id: "abc123.filterdrecv-1.3" },
  { event: "bounce", sg_event_id: "ev-5", sg_message_id: "def456.filterdrecv-2.0" },
]);

describe("what is sent", () => {
  it("carries both parts, plain text first, and the outbox id", () => {
    const body = sendGridBody(message, "learn@example.test");
    expect(body.personalizations).toEqual([{ to: [{ email: "amber@example.test" }] }]);
    expect(body.from).toEqual({ email: "learn@example.test" });
    expect(body.content.map((part) => part.type)).toEqual(["text/plain", "text/html"]);
    expect(body.custom_args.outbox_id).toBe(message.idempotencyKey);
  });

  it("switches off the tracking that would rewrite links through SendGrid", () => {
    const body = sendGridBody(message, "learn@example.test");
    expect(body.tracking_settings.click_tracking.enable).toBe(false);
    expect(body.tracking_settings.click_tracking.enable_text).toBe(false);
    expect(body.tracking_settings.open_tracking.enable).toBe(false);
    expect(body.tracking_settings.subscription_tracking.enable).toBe(false);
  });
});

describe("reading SendGrid's answer", () => {
  const provider = () => new SendGridEmailProvider("SG.test", "learn@example.test", 50);

  it("returns the X-Message-Id of an accepted message", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202, headers: { "X-Message-Id": "abc123" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider().send(message)).resolves.toEqual({ providerId: "abc123" });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.sendgrid.com/v3/mail/send");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer SG.test");
  });

  it("treats an acceptance without an id as uncertain", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 202 })));
    await expect(provider().send(message)).rejects.toBeInstanceOf(EmailUncertain);
  });

  it("records a 400 as a definitive rejection", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad address", { status: 400 })));
    await expect(provider().send(message)).rejects.toBeInstanceOf(EmailRejected);
  });

  it("does not call a 429 or a 5xx a rejection", async () => {
    for (const status of [429, 500, 503]) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status })));
      await expect(provider().send(message)).rejects.toBeInstanceOf(EmailUncertain);
    }
  });

  it("does not call a timeout a rejection", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" }))
            );
          })
      )
    );
    await expect(provider().send(message)).rejects.toBeInstanceOf(EmailUncertain);
  });
});

describe("AC-049 a SendGrid callback", () => {
  it("is accepted when correctly signed, keeping only the events the outbox tracks", () => {
    const events = verifySendGridWebhook(batch, signedHeaders(batch));
    expect(events).toEqual([
      { providerEventId: "ev-1", providerEmailId: "abc123", type: "accepted" },
      { providerEventId: "ev-2", providerEmailId: "abc123", type: "delivered" },
      { providerEventId: "ev-5", providerEmailId: "def456", type: "bounced" },
    ]);
  });

  it("is refused when the body was altered after signing", () => {
    const headers = signedHeaders(batch);
    const tampered = batch.replace("def456", "somebody_elses");
    expect(() => verifySendGridWebhook(tampered, headers)).toThrow();
  });

  it("is refused when the timestamp was altered after signing", () => {
    const headers = signedHeaders(batch);
    headers.set("X-Twilio-Email-Event-Webhook-Timestamp", "1761200001");
    expect(() => verifySendGridWebhook(batch, headers)).toThrow();
  });

  it("is refused when signed by another key", () => {
    const other = generateKeyPairSync("ec", { namedCurve: "prime256v1" }).privateKey;
    const signature = sign("sha256", Buffer.from("1761200000" + batch), other).toString("base64");
    const headers = new Headers({
      "X-Twilio-Email-Event-Webhook-Signature": signature,
      "X-Twilio-Email-Event-Webhook-Timestamp": "1761200000",
    });
    expect(() => verifySendGridWebhook(batch, headers)).toThrow();
  });

  it("is refused when the signature headers are missing", () => {
    expect(() => verifySendGridWebhook(batch, new Headers())).toThrow();
  });

  it("is not configured without a verification key", () => {
    delete process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;
    resetServerEnvCache();
    expect(() => verifySendGridWebhook(batch, signedHeaders(batch))).toThrow(EmailNotConfiguredError);
  });

  it("refuses a signed body that is not a batch", () => {
    const single = JSON.stringify({ event: "delivered", sg_event_id: "ev-9" });
    expect(() => verifySendGridWebhook(single, signedHeaders(single))).toThrow();
  });
});

describe("AC-049 SendGrid's vocabulary", () => {
  it("maps the final outcomes onto the outbox's", () => {
    expect(normalizeSendGridEventType("processed")).toBe("accepted");
    expect(normalizeSendGridEventType("delivered")).toBe("delivered");
    expect(normalizeSendGridEventType("bounce")).toBe("bounced");
    expect(normalizeSendGridEventType("spamreport")).toBe("complained");
    expect(normalizeSendGridEventType("dropped")).toBe("failed");
  });

  it("ignores engagement and deferral rather than failing the message", () => {
    for (const event of ["deferred", "open", "click", "unsubscribe", "group_unsubscribe", ""]) {
      expect(normalizeSendGridEventType(event)).toBeNull();
    }
  });

  it("strips SendGrid's routing suffix to find the saved message id", () => {
    expect(sendGridMessageId("abc123.filterdrecv-5645d9c87f-78xgx-1-5E4E1E9B-1.0")).toBe("abc123");
    expect(sendGridMessageId("abc123")).toBe("abc123");
  });
});

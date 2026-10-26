import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHash } from "node:crypto";

/*
 * D-27, D-28: the invitation email (features/organizations/invitation-email.ts)
 * and the 7-day link it carries (features/organizations/invitation-link.ts).
 */

const INVITATION = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const rpc = vi.fn();
const getUserById = vi.fn();
const generateLink = vi.fn();
const send = vi.fn();
const verifyOtp = vi.fn();
let provider: { send: typeof send } | null = { send };

vi.mock("@/lib/supabase/server", () => ({
  serviceClient: () => ({ rpc, auth: { admin: { getUserById, generateLink } } }),
  userClient: async () => ({ auth: { verifyOtp } }),
}));
vi.mock("@/lib/email/provider", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/email/provider")>();
  return { ...real, emailProvider: () => provider, maySendTo: () => true };
});

const ORIGINAL = { ...process.env };
beforeEach(async () => {
  process.env = {
    ...ORIGINAL,
    NEXT_PUBLIC_APP_URL: "https://pglearn.example",
    NEXT_PUBLIC_SUPABASE_URL: "https://example-ref.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
  };
  (await import("@/lib/env")).resetServerEnvCache();
  provider = { send };
  for (const mock of [rpc, getUserById, generateLink, send, verifyOtp]) mock.mockReset();
});
afterEach(() => {
  process.env = { ...ORIGINAL };
});

function context(overrides: Record<string, unknown> = {}) {
  return {
    invitation_id: INVITATION, status: "pending", user_id: USER, email: "amber@example.test",
    display_name: "Amber", onboarded: false, organization_name: "NSCSS", sent: false, ...overrides,
  };
}

/** rpc answers invitation.context with ctx and records every other job. */
function databaseWith(ctx: Record<string, unknown>) {
  rpc.mockImplementation(async (_fn: string, { job }: { job: string }) =>
    job === "invitation.context" ? { data: ctx, error: null } : { data: { status: "x" }, error: null }
  );
}
const jobs = (name: string) =>
  rpc.mock.calls.filter(([, args]) => args.job === name).map(([, args]) => args.payload);
const recorded = () => jobs("invitation.sent");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** The token in the link of the email sent. */
function sentToken(): string {
  const match = /https:\/\/pglearn\.example\/invite\/([A-Za-z0-9_-]+)/.exec(send.mock.calls[0][0].text);
  if (!match) throw new Error("no invitation link in the email");
  return match[1];
}

describe("sending the invitation", () => {
  it("sends a 7-day link of ours and stores only its hash", async () => {
    databaseWith(context());
    send.mockResolvedValue({ providerId: "sg-1" });
    const { sendInvitationEmail } = await import("@/features/organizations/invitation-email");

    expect(await sendInvitationEmail(INVITATION)).toBe("accepted");
    const message = send.mock.calls[0][0];
    expect(message.to).toBe("amber@example.test");
    expect(message.text).toContain("NSCSS");
    expect(message.text).toContain("valid for 7 days");

    const token = sentToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(jobs("invitation.link")).toEqual([{ invitation_id: INVITATION, token_hash: sha256(token) }]);
    expect(recorded()).toEqual([{ invitation_id: INVITATION, outcome: "accepted", provider_id: "sg-1" }]);
    // The token goes in the email only: never to the database, never as the key.
    expect(JSON.stringify(rpc.mock.calls)).not.toContain(token);
    expect(message.idempotencyKey).not.toContain(token);
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("issues a new link, under a new provider key, on each send", async () => {
    send.mockResolvedValue({ providerId: "sg-2" });
    const { sendInvitationEmail } = await import("@/features/organizations/invitation-email");
    databaseWith(context());
    await sendInvitationEmail(INVITATION);
    databaseWith(context());
    await sendInvitationEmail(INVITATION);
    const [first, second] = jobs("invitation.link");
    expect(first.token_hash).not.toBe(second.token_hash);
    expect(send.mock.calls[0][0].idempotencyKey).not.toBe(send.mock.calls[1][0].idempotencyKey);
    expect(send.mock.calls[0][0].idempotencyKey.startsWith(`${INVITATION}:`)).toBe(true);
  });

  it("does not send twice for a retried request", async () => {
    databaseWith(context({ sent: true }));
    const { sendInvitationEmail } = await import("@/features/organizations/invitation-email");
    expect(await sendInvitationEmail(INVITATION)).toBe("not_sent");
    expect(send).not.toHaveBeenCalled();
    expect(recorded()).toEqual([]);
    expect(jobs("invitation.link")).toEqual([]);
  });

  it("does not send for an invitation that is no longer pending", async () => {
    databaseWith(context({ status: "accepted" }));
    const { sendInvitationEmail } = await import("@/features/organizations/invitation-email");
    expect(await sendInvitationEmail(INVITATION)).toBe("not_sent");
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves the invitation alone when no provider is configured", async () => {
    databaseWith(context());
    provider = null;
    const { sendInvitationEmail } = await import("@/features/organizations/invitation-email");
    expect(await sendInvitationEmail(INVITATION)).toBe("not_sent");
    expect(jobs("invitation.link")).toEqual([]);
  });

  it("records a definitive rejection as failed and anything else as uncertain", async () => {
    const { EmailRejected, EmailUncertain } = await import("@/lib/email/provider");
    const { sendInvitationEmail } = await import("@/features/organizations/invitation-email");

    databaseWith(context());
    send.mockRejectedValueOnce(new EmailRejected("bad address"));
    expect(await sendInvitationEmail(INVITATION)).toBe("failed");
    expect(recorded().at(-1)).toMatchObject({ outcome: "rejected" });

    databaseWith(context());
    send.mockRejectedValueOnce(new EmailUncertain("timeout"));
    expect(await sendInvitationEmail(INVITATION)).toBe("uncertain");
    expect(recorded().at(-1)).toMatchObject({ outcome: "unknown" });
  });
});

describe("opening the link", () => {
  const TOKEN = "A".repeat(43);
  const found = (overrides: Record<string, unknown> = {}) => ({
    invitation_id: INVITATION, user_id: USER, email: "amber@example.test", onboarded: false, ...overrides,
  });
  function redeemAnswers(data: unknown, error: { code: string } | null = null) {
    rpc.mockImplementation(async () => ({ data, error }));
  }

  it("looks the invitation up by the token's hash, not the token", async () => {
    redeemAnswers(found());
    const { findInvitationByLink } = await import("@/features/organizations/invitation-link");
    expect(await findInvitationByLink(TOKEN)).toMatchObject({ invitation_id: INVITATION });
    expect(rpc).toHaveBeenCalledWith("pglearn_job", { job: "invitation.redeem", payload: { token_hash: sha256(TOKEN) } });
  });

  it("does not ask the database about something that is not a token", async () => {
    const { findInvitationByLink } = await import("@/features/organizations/invitation-link");
    for (const bad of ["", "short", "A".repeat(44), `${"A".repeat(42)}/`, INVITATION]) {
      expect(await findInvitationByLink(bad)).toBeNull();
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sends an expired, used or replaced link to the login page", async () => {
    redeemAnswers(null, { code: "P0002" });
    const { signInWithInvitationLink } = await import("@/features/organizations/invitation-link");
    expect(await signInWithInvitationLink(TOKEN)).toBe("/login?link=invalid");
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("signs a new invitee in and sends them to choose a password, then the invitation", async () => {
    redeemAnswers(found());
    getUserById.mockResolvedValue({ data: { user: { email_confirmed_at: null } } });
    generateLink.mockResolvedValue({ data: { properties: { hashed_token: "otp-hash" } }, error: null });
    verifyOtp.mockResolvedValue({ error: null });
    const { signInWithInvitationLink } = await import("@/features/organizations/invitation-link");

    expect(await signInWithInvitationLink(TOKEN)).toBe(`/set-password?next=%2Finvitations%2F${INVITATION}`);
    expect(generateLink).toHaveBeenCalledWith({ type: "invite", email: "amber@example.test" });
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "otp-hash", type: "invite" });
  });

  it("falls back to a sign-in token when Auth refuses an invite one", async () => {
    redeemAnswers(found());
    getUserById.mockResolvedValue({ data: { user: { email_confirmed_at: null } } });
    generateLink
      .mockResolvedValueOnce({ data: { properties: null }, error: { code: "email_exists" } })
      .mockResolvedValueOnce({ data: { properties: { hashed_token: "h2" } }, error: null });
    verifyOtp.mockResolvedValue({ error: null });
    const { signInWithInvitationLink } = await import("@/features/organizations/invitation-link");

    await signInWithInvitationLink(TOKEN);
    expect(verifyOtp).toHaveBeenCalledWith({ token_hash: "h2", type: "magiclink" });
  });

  it("does not sign in someone who already uses PGLearn; they log in themselves (spec/03)", async () => {
    redeemAnswers(found({ onboarded: true }));
    const { signInWithInvitationLink } = await import("@/features/organizations/invitation-link");
    expect(await signInWithInvitationLink(TOKEN)).toBe(`/invitations/${INVITATION}`);
    expect(generateLink).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("sends the person to the login page when the sign-in fails", async () => {
    redeemAnswers(found());
    getUserById.mockResolvedValue({ data: { user: { email_confirmed_at: "2026-10-01T00:00:00Z" } } });
    generateLink.mockResolvedValue({ data: { properties: { hashed_token: "h" } }, error: null });
    verifyOtp.mockResolvedValue({ error: { code: "otp_expired" } });
    const { signInWithInvitationLink } = await import("@/features/organizations/invitation-link");
    expect(await signInWithInvitationLink(TOKEN)).toBe("/login?link=invalid");
  });
});

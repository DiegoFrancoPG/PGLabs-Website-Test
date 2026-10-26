import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CONFIRM_TYPES, safeNext } from "@/lib/auth-links";

/*
 * D-27: the invitation email (features/organizations/invitation-email.ts) and
 * the links it carries (lib/auth-links, /auth/confirm, /auth/verify).
 */

const INVITATION = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";

const rpc = vi.fn();
const getUserById = vi.fn();
const generateLink = vi.fn();
const send = vi.fn();
let provider: { send: typeof send } | null = { send };

vi.mock("@/lib/supabase/server", () => ({
  serviceClient: () => ({ rpc, auth: { admin: { getUserById, generateLink } } }),
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
  for (const mock of [rpc, getUserById, generateLink, send]) mock.mockReset();
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

/** rpc answers invitation.context with ctx and records every invitation.sent. */
function databaseWith(ctx: Record<string, unknown>) {
  rpc.mockImplementation(async (_fn: string, { job }: { job: string }) =>
    job === "invitation.context" ? { data: ctx, error: null } : { data: { status: "x" }, error: null }
  );
}
const recorded = () =>
  rpc.mock.calls.filter(([, args]) => args.job === "invitation.sent").map(([, args]) => args.payload);

describe("the links", () => {
  it("lands a new invitee on choosing a password, then the invitation", async () => {
    const { nextAfterConfirm } = await import("@/features/organizations/invitation-email");
    expect(nextAfterConfirm(INVITATION, false)).toBe(`/set-password?next=%2Finvitations%2F${INVITATION}`);
    expect(nextAfterConfirm(INVITATION, true)).toBe(`/invitations/${INVITATION}`);
  });

  it("points at our own confirm page, never at Auth's verify endpoint", async () => {
    const { confirmUrl } = await import("@/features/organizations/invitation-email");
    const url = new URL(confirmUrl("https://pglearn.example/", "hash", "invite", "/invitations/x"));
    expect(url.origin + url.pathname).toBe("https://pglearn.example/auth/confirm");
    expect(url.searchParams.get("token_hash")).toBe("hash");
    expect(url.searchParams.get("type")).toBe("invite");
    expect(url.searchParams.get("next")).toBe("/invitations/x");
  });

  it("follows only same-site paths afterwards", () => {
    expect(safeNext("/invitations/x")).toBe("/invitations/x");
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "", undefined, null]) {
      expect(safeNext(bad)).toBe("/learn");
    }
  });

  it("exchanges only the two link types the email sends", () => {
    expect([...CONFIRM_TYPES]).toEqual(["invite", "magiclink"]);
  });
});

describe("sending the invitation", () => {
  it("sends a fresh link to a new invitee and records it without the link", async () => {
    databaseWith(context());
    getUserById.mockResolvedValue({ data: { user: { email_confirmed_at: null } } });
    generateLink.mockResolvedValue({ data: { properties: { hashed_token: "secret-hash" } }, error: null });
    send.mockResolvedValue({ providerId: "sg-1" });
    const { sendInvitationEmail } = await import("@/features/organizations/invitation-email");

    expect(await sendInvitationEmail(INVITATION)).toBe("accepted");
    expect(generateLink).toHaveBeenCalledWith({ type: "invite", email: "amber@example.test" });
    const message = send.mock.calls[0][0];
    expect(message.to).toBe("amber@example.test");
    expect(message.idempotencyKey).toBe(INVITATION);
    expect(message.text).toContain("https://pglearn.example/auth/confirm?token_hash=secret-hash&type=invite");
    expect(message.text).toContain("NSCSS");
    expect(recorded()).toEqual([{ invitation_id: INVITATION, outcome: "accepted", provider_id: "sg-1" }]);
    expect(JSON.stringify(recorded())).not.toContain("secret-hash");
  });

  it("sends a sign-in link to someone who already confirmed their account", async () => {
    databaseWith(context({ onboarded: true }));
    getUserById.mockResolvedValue({ data: { user: { email_confirmed_at: "2026-10-01T00:00:00Z" } } });
    generateLink.mockResolvedValue({ data: { properties: { hashed_token: "h" } }, error: null });
    send.mockResolvedValue({ providerId: "sg-2" });
    const { sendInvitationEmail } = await import("@/features/organizations/invitation-email");

    await sendInvitationEmail(INVITATION);
    expect(generateLink).toHaveBeenCalledWith({ type: "magiclink", email: "amber@example.test" });
    expect(send.mock.calls[0][0].text).toContain(`next=%2Finvitations%2F${INVITATION}`);
  });

  it("falls back to a sign-in link when Auth refuses an invite link", async () => {
    databaseWith(context());
    getUserById.mockResolvedValue({ data: { user: { email_confirmed_at: null } } });
    generateLink
      .mockResolvedValueOnce({ data: { properties: null }, error: { code: "email_exists" } })
      .mockResolvedValueOnce({ data: { properties: { hashed_token: "h2" } }, error: null });
    send.mockResolvedValue({ providerId: "sg-3" });
    const { sendInvitationEmail } = await import("@/features/organizations/invitation-email");

    expect(await sendInvitationEmail(INVITATION)).toBe("accepted");
    expect(send.mock.calls[0][0].text).toContain("token_hash=h2&type=magiclink");
  });

  it("does not send twice for a retried request", async () => {
    databaseWith(context({ sent: true }));
    const { sendInvitationEmail } = await import("@/features/organizations/invitation-email");
    expect(await sendInvitationEmail(INVITATION)).toBe("not_sent");
    expect(send).not.toHaveBeenCalled();
    expect(recorded()).toEqual([]);
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
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("records a definitive rejection as failed and anything else as uncertain", async () => {
    const { EmailRejected, EmailUncertain } = await import("@/lib/email/provider");
    const { sendInvitationEmail } = await import("@/features/organizations/invitation-email");
    getUserById.mockResolvedValue({ data: { user: { email_confirmed_at: null } } });
    generateLink.mockResolvedValue({ data: { properties: { hashed_token: "h" } }, error: null });

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

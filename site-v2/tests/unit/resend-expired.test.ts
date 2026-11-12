import { describe, it, expect } from "vitest";
import { expiredInvitations, organizationMemberSchema } from "@/features/organizations/organizations";
import { derivedKey } from "@/lib/derived-key";

/*
 * D-30: which invitations "Resend expired invitations" resends, and the keys
 * that make pressing it twice harmless.
 */

const NOW = new Date("2026-11-12T17:00:00Z");
const PAST = "2026-11-10T22:42:34Z";
const FUTURE = "2026-11-19T22:42:34Z";

let n = 0;
function member(status: "invited" | "active" | "removed", invitation: { status: string; expires_at: string } | null) {
  n += 1;
  return organizationMemberSchema.parse({
    user_id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    display_name: `Person ${n}`,
    email: `person${n}@example.test`,
    role: "learner",
    status,
    onboarded: status === "active",
    invitation: invitation && { id: `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`, ...invitation },
  });
}

describe("expired invitations", () => {
  it("takes a still-invited person whose pending invitation is past its date", () => {
    const lapsed = member("invited", { status: "pending", expires_at: PAST });
    expect(expiredInvitations([lapsed], NOW)).toEqual([
      { invitationId: lapsed.invitation!.id, name: lapsed.display_name, email: lapsed.email },
    ]);
  });

  it("takes one already marked expired", () => {
    expect(expiredInvitations([member("invited", { status: "expired", expires_at: PAST })], NOW)).toHaveLength(1);
  });

  it("leaves alone a link still valid, an accepted one, people who joined or left, and test accounts", () => {
    const untouched = [
      member("invited", { status: "pending", expires_at: FUTURE }),
      member("active", { status: "accepted", expires_at: PAST }),
      member("active", { status: "pending", expires_at: PAST }),
      member("removed", { status: "expired", expires_at: PAST }),
      member("invited", { status: "cancelled", expires_at: PAST }),
      member("active", null),
    ];
    expect(expiredInvitations(untouched, NOW)).toEqual([]);
  });

  it("reads a member list from a database without M44 as never invited", () => {
    const parsed = organizationMemberSchema.parse({
      user_id: "00000000-0000-4000-8000-000000000999",
      display_name: "Old",
      email: "old@example.test",
      role: "learner",
      status: "invited",
      onboarded: false,
    });
    expect(parsed.invitation).toBeNull();
    expect(expiredInvitations([parsed], NOW)).toEqual([]);
  });
});

describe("derived keys", () => {
  it("are the same for the same invitation, different for another, and uuid-shaped", async () => {
    const a = await derivedKey("resend-expired", "11111111-1111-4111-8111-000000000001");
    expect(await derivedKey("resend-expired", "11111111-1111-4111-8111-000000000001")).toBe(a);
    expect(await derivedKey("resend-expired", "11111111-1111-4111-8111-000000000002")).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

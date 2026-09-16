import { describe, it, expect } from "vitest";
import { profilePatchSchema } from "@/features/identity/me";

/*
 * AC-006, at the schema layer. spec/02: "Public profile edit allows
 * display_name/timezone/reminders_enabled only."
 *
 * The schema REJECTS rather than strips. Silently dropping an attempt to set
 * platform_admin would let a caller believe it had worked.
 */
describe("ProfilePatch", () => {
  it("accepts the three permitted fields", () => {
    expect(profilePatchSchema.safeParse({ display_name: "Amber" }).success).toBe(true);
    expect(profilePatchSchema.safeParse({ timezone: "America/Vancouver" }).success).toBe(true);
    expect(profilePatchSchema.safeParse({ reminders_enabled: false }).success).toBe(true);
  });

  it.each([
    ["platform_admin", { platform_admin: true }],
    ["email", { email: "attacker@example.invalid" }],
    ["role", { role: "manager" }],
    ["id", { id: "00000000-0000-4000-8000-000000000000" }],
    ["onboarded_at", { onboarded_at: "2026-01-01T00:00:00Z" }],
    ["status", { status: "active" }],
    ["organization_id", { organization_id: "00000000-0000-4000-8000-000000000000" }],
  ])("rejects an attempt to set %s", (_name, payload) => {
    const result = profilePatchSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("rejects a privileged field even when smuggled beside a legitimate one", () => {
    const result = profilePatchSchema.safeParse({ display_name: "Amber", platform_admin: true });
    expect(result.success).toBe(false);
  });

  it("requires at least one field, per the contract's minProperties", () => {
    expect(profilePatchSchema.safeParse({}).success).toBe(false);
  });

  it("enforces the contract's display_name bounds", () => {
    expect(profilePatchSchema.safeParse({ display_name: "" }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ display_name: "   " }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ display_name: "a".repeat(121) }).success).toBe(false);
    expect(profilePatchSchema.safeParse({ display_name: "a".repeat(120) }).success).toBe(true);
  });
});

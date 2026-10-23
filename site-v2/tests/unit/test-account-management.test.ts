import { describe, it, expect } from "vitest";
import { testAccountPatchSchema, testAccountPasswordSchema } from "@/features/organizations/test-accounts";

/* M40 (D-25): managing a test organization's accounts. */
describe("changing a test account", () => {
  it("accepts a role, a status, or both", () => {
    expect(testAccountPatchSchema.safeParse({ role: "manager" }).success).toBe(true);
    expect(testAccountPatchSchema.safeParse({ status: "removed" }).success).toBe(true);
    expect(testAccountPatchSchema.safeParse({ role: "learner", status: "active" }).success).toBe(true);
  });

  it("refuses an empty change, an unknown role or status, and other fields", () => {
    expect(testAccountPatchSchema.safeParse({}).success).toBe(false);
    expect(testAccountPatchSchema.safeParse({ role: "admin" }).success).toBe(false);
    // "invited" is a state an invitation leaves, not one an administrator sets.
    expect(testAccountPatchSchema.safeParse({ status: "invited" }).success).toBe(false);
    expect(testAccountPatchSchema.safeParse({ role: "learner", user_id: "x" }).success).toBe(false);
  });
});

describe("resetting a test account's password", () => {
  it("generates one when none is given", () => {
    expect(testAccountPasswordSchema.safeParse({}).success).toBe(true);
  });

  it("takes a chosen password of 10 to 72 characters", () => {
    expect(testAccountPasswordSchema.safeParse({ password: "a".repeat(10) }).success).toBe(true);
    expect(testAccountPasswordSchema.safeParse({ password: "a".repeat(9) }).success).toBe(false);
    expect(testAccountPasswordSchema.safeParse({ password: "a".repeat(73) }).success).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { memberProfilePatchSchema } from "@/features/organizations/organizations";

/* contracts/api.json MemberProfilePatch (M30, D-07): what an admin may correct. */
describe("MemberProfilePatch", () => {
  it("accepts a name, an email, or both", () => {
    expect(memberProfilePatchSchema.safeParse({ display_name: "Mona" }).success).toBe(true);
    expect(memberProfilePatchSchema.safeParse({ email: "mona@example.org" }).success).toBe(true);
    expect(
      memberProfilePatchSchema.safeParse({ display_name: "Mona", email: "mona@example.org" }).success
    ).toBe(true);
  });

  it("trims the name and refuses a blank or overlong one", () => {
    expect(memberProfilePatchSchema.parse({ display_name: "  Mona  " }).display_name).toBe("Mona");
    expect(memberProfilePatchSchema.safeParse({ display_name: "   " }).success).toBe(false);
    expect(memberProfilePatchSchema.safeParse({ display_name: "x".repeat(121) }).success).toBe(false);
  });

  it("refuses an invalid email, an empty body and any other field", () => {
    expect(memberProfilePatchSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
    expect(memberProfilePatchSchema.safeParse({}).success).toBe(false);
    expect(memberProfilePatchSchema.safeParse({ role: "manager" }).success).toBe(false);
    expect(memberProfilePatchSchema.safeParse({ display_name: "Mona", platform_admin: true }).success).toBe(false);
  });
});

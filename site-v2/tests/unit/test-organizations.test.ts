import { describe, it, expect } from "vitest";
import { moveToLatestSchema, organizationSchema, organizationTestSchema } from "@/features/organizations/organizations";

/* M33 (D-13): test organizations. */
describe("test organizations", () => {
  it("reads an organization from a database without M33 as not a test one", () => {
    const org = organizationSchema.parse({
      id: "00000000-0000-4000-8000-000000000001",
      name: "PeaceGeeks",
      timezone: "UTC",
      status: "active",
    });
    expect(org.is_test).toBe(false);
  });

  it("accepts only the documented bodies", () => {
    expect(organizationTestSchema.safeParse({ is_test: true }).success).toBe(true);
    expect(organizationTestSchema.safeParse({ is_test: "yes" }).success).toBe(false);
    expect(moveToLatestSchema.safeParse({ program_id: "00000000-0000-4000-8000-000000000002" }).success).toBe(true);
    expect(moveToLatestSchema.safeParse({ program_id: "x", version_id: "y" }).success).toBe(false);
  });
});

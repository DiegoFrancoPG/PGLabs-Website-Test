import { z } from "zod";
import { callRpc } from "@/lib/rpc";

/* Mirrors contracts/api.json's Organization, OrganizationPatch and MembershipPatch. */
export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  timezone: z.string(),
  status: z.enum(["active", "suspended"]),
});

export type Organization = z.infer<typeof organizationSchema>;

export const organizationListSchema = z.object({
  items: z.array(organizationSchema),
  next_cursor: z.string().nullable(),
});

export const organizationPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    timezone: z.string().min(1).optional(),
    status: z.enum(["active", "suspended"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

export const membershipPatchSchema = z
  .object({
    role: z.enum(["manager", "learner"]).optional(),
    status: z.enum(["active", "removed"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

export async function listOrganizations(limit = 20) {
  return organizationListSchema.parse(await callRpc("list_organizations", { limit }));
}

export async function updateOrganization(
  organizationId: string,
  patch: z.infer<typeof organizationPatchSchema>
): Promise<Organization> {
  return organizationSchema.parse(
    await callRpc("update_organization", { organization_id: organizationId, ...patch })
  );
}

export async function updateMembership(
  organizationId: string,
  userId: string,
  patch: z.infer<typeof membershipPatchSchema>
) {
  return callRpc("update_membership", {
    organization_id: organizationId,
    user_id: userId,
    ...patch,
  });
}

import { z } from "zod";
import { callRpc, RpcError } from "@/lib/rpc";
import { normalizeEmail } from "@/lib/email-address";
import { serviceClient } from "@/lib/supabase/server";

/* Mirrors contracts/api.json's Organization, OrganizationPatch and MembershipPatch. */
export const organizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  timezone: z.string(),
  status: z.enum(["active", "suspended"]),
  // M33 (D-13). Defaults to false so a database without M33 still reads.
  is_test: z.boolean().default(false),
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

/* M30 (D-07): contracts/api.json's OrganizationMember, MemberProfilePatch and MemberProfile. */
export const organizationMemberSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  email: z.string(),
  role: z.enum(["manager", "learner"]),
  status: z.enum(["invited", "active", "removed"]),
  onboarded: z.boolean(),
});

export type OrganizationMember = z.infer<typeof organizationMemberSchema>;

export const memberProfilePatchSchema = z
  .object({
    display_name: z.string().trim().min(1).max(120).optional(),
    email: z.string().email().max(254).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

export const memberProfileSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  email: z.string(),
});

export async function listOrganizationMembers(organizationId: string) {
  return z
    .object({ items: z.array(organizationMemberSchema), next_cursor: z.string().nullable() })
    .parse(await callRpc("list_organization_members", { organization_id: organizationId }));
}

/*
 * The name is the database's; the email is Auth's. So the RPC runs first —
 * it is also the admin check, so nobody else reaches the Auth admin API —
 * and only then is the address changed in Auth and re-synced into the
 * profile by pglearn_provision, which reads it from auth.users rather than
 * from this input (spec/02).
 */
export async function updateMemberProfile(
  userId: string,
  patch: z.infer<typeof memberProfilePatchSchema>
) {
  const current = memberProfileSchema.parse(
    await callRpc("update_member_profile", {
      user_id: userId,
      ...(patch.display_name !== undefined ? { display_name: patch.display_name } : {}),
    })
  );

  const email = patch.email ? normalizeEmail(patch.email) : null;
  if (!email || email === current.email) return current;

  const service = serviceClient();
  const { error } = await service.auth.admin.updateUserById(userId, {
    email,
    // An admin is correcting the address, not the person proving they own it;
    // the invitation or a password reset is what reaches them there.
    email_confirm: true,
  });
  if (error) {
    // The usual cause is an address another account already uses.
    throw new RpcError("CONFLICT", "That email address could not be used. It may belong to another account.");
  }

  const { error: provisionError } = await service.rpc("pglearn_provision", {
    payload: { user_id: userId },
  });
  if (provisionError) throw new Error(`profile re-sync failed: ${provisionError.message}`);

  return { ...current, email };
}

/* M33 (D-13): test organizations, and moving their people to the latest version. */
export const organizationTestSchema = z.object({ is_test: z.boolean() }).strict();

export const moveToLatestSchema = z.object({ program_id: z.string().uuid() }).strict();

export const moveToLatestResultSchema = z.object({
  version_number: z.number().int(),
  moved: z.number().int(),
  skipped_completed: z.number().int(),
  progress_copied: z.number().int(),
});

export async function setOrganizationTest(organizationId: string, input: z.infer<typeof organizationTestSchema>) {
  return organizationSchema.parse(
    await callRpc("set_organization_test", { organization_id: organizationId, ...input })
  );
}

export async function moveToLatestVersion(organizationId: string, input: z.infer<typeof moveToLatestSchema>) {
  return moveToLatestResultSchema.parse(
    await callRpc("move_to_latest_version", { organization_id: organizationId, ...input })
  );
}

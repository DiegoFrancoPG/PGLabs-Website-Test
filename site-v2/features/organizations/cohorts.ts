import { z } from "zod";
import { callRpc } from "@/lib/rpc";

/* Mirrors contracts/api.json's Cohort, CohortCreate and CohortPatch. */
export const cohortSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string().min(1).max(120),
  archived_at: z.string().nullable(),
});

export const cohortCreateSchema = z
  .object({
    organization_id: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
  })
  .strict();

export const cohortPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

/* Adding members never enrols them — spec/03 keeps assignment a separate act. */
export const cohortMembersAddSchema = z
  .object({ user_ids: z.array(z.string().uuid()).min(1) })
  .strict();

const listSchema = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), next_cursor: z.string().nullable() });

export const cohortMemberSchema = z.object({
  user_id: z.string().uuid(),
  display_name: z.string(),
  email: z.string(),
  status: z.enum(["active", "removed"]),
  membership_status: z.enum(["invited", "active", "removed"]),
});

export async function listCohorts(organizationId?: string) {
  return listSchema(cohortSchema).parse(
    await callRpc("list_cohorts", organizationId ? { organization_id: organizationId } : {})
  );
}

export async function createCohort(input: z.infer<typeof cohortCreateSchema>, requestId: string) {
  return cohortSchema.parse(await callRpc("create_cohort", { request_id: requestId, ...input }));
}

export async function updateCohort(cohortId: string, patch: z.infer<typeof cohortPatchSchema>) {
  return cohortSchema.parse(await callRpc("update_cohort", { cohort_id: cohortId, ...patch }));
}

export async function listCohortMembers(cohortId: string) {
  return listSchema(cohortMemberSchema).parse(
    await callRpc("list_cohort_members", { cohort_id: cohortId })
  );
}

export async function addCohortMembers(
  cohortId: string,
  input: z.infer<typeof cohortMembersAddSchema>,
  requestId: string
) {
  return callRpc("add_cohort_members", { request_id: requestId, cohort_id: cohortId, ...input });
}

export async function removeCohortMember(cohortId: string, userId: string) {
  return callRpc("remove_cohort_member", { cohort_id: cohortId, user_id: userId });
}

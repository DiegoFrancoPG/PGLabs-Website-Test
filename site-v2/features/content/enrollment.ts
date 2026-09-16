import { z } from "zod";
import { callRpc } from "@/lib/rpc";

/* Mirrors contracts/api.json's Offering, OfferingCreate, OfferingPatch and EnrollmentPatch. */
export const offeringCreateSchema = z
  .object({
    cohort_id: z.string().uuid(),
    version_id: z.string().uuid(),
    grant_id: z.string().uuid(),
    starts_at: z.string().datetime(),
    due_at: z.string().datetime(),
    access_ends_at: z.string().datetime().nullable(),
  })
  .strict();

/*
 * apply_to_enrollment_ids is REQUIRED by the contract even when empty: a date
 * change has to say explicitly who it touches, because spec/03 applies it "only
 * to selected active incomplete enrollment IDs".
 */
export const offeringPatchSchema = z
  .object({
    starts_at: z.string().datetime().optional(),
    due_at: z.string().datetime().optional(),
    access_ends_at: z.string().datetime().nullable().optional(),
    status: z.enum(["active", "cancelled"]).optional(),
    apply_to_enrollment_ids: z.array(z.string().uuid()).max(100),
  })
  .strict()
  .refine(
    (v) =>
      v.starts_at !== undefined ||
      v.due_at !== undefined ||
      v.access_ends_at !== undefined ||
      v.status !== undefined,
    { message: "give at least one date or a status" }
  );

export const enrollCohortSchema = z
  .object({ user_ids: z.array(z.string().uuid()).min(1).max(500) })
  .strict();

export const enrollPersonalSchema = z
  .object({
    grant_id: z.string().uuid(),
    version_id: z.string().uuid(),
    starts_at: z.string().datetime(),
    due_at: z.string().datetime(),
    access_ends_at: z.string().datetime().nullable(),
  })
  .strict();

export const enrollmentPatchSchema = z
  .object({ status: z.enum(["active", "cancelled"]) })
  .strict();

/* contracts/api.json's Offering. It carries ids and dates, and no titles. */
export const offeringSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  program_id: z.string().uuid(),
  cohort_id: z.string().uuid(),
  version_id: z.string().uuid(),
  grant_id: z.string().uuid(),
  starts_at: z.string(),
  due_at: z.string(),
  access_ends_at: z.string().nullable(),
  status: z.enum(["active", "cancelled"]),
});

export type Offering = z.infer<typeof offeringSchema>;

export const offeringListSchema = z.object({
  items: z.array(offeringSchema),
  next_cursor: z.string().nullable(),
});

export const listOfferings = async (organizationId?: string) =>
  offeringListSchema.parse(
    await callRpc("list_offerings", organizationId ? { organization_id: organizationId } : {})
  );

export const createOffering = (input: z.infer<typeof offeringCreateSchema>, requestId: string) =>
  callRpc("create_offering", { request_id: requestId, ...input });

export const updateOffering = (offeringId: string, patch: z.infer<typeof offeringPatchSchema>) =>
  callRpc("update_offering", { offering_id: offeringId, ...patch });

export const enrollCohort = (
  offeringId: string,
  input: z.infer<typeof enrollCohortSchema>,
  requestId: string
) => callRpc("enroll_cohort", { request_id: requestId, offering_id: offeringId, ...input });

export const enrollPersonal = (input: z.infer<typeof enrollPersonalSchema>, requestId: string) =>
  callRpc("enroll_personal", { request_id: requestId, ...input });

export const updateEnrollment = (
  enrollmentId: string,
  patch: z.infer<typeof enrollmentPatchSchema>
) => callRpc("update_enrollment", { enrollment_id: enrollmentId, ...patch });

import { z } from "zod";
import { callRpc } from "@/lib/rpc";

/* Mirrors contracts/api.json's Enrollment, EnrollmentDetail and ClassDetail. */

export const availabilitySchema = z.enum([
  "available",
  "not_started",
  "expired",
  "revoked",
  "membership_inactive",
  "cancelled",
  "account_inactive",
]);

export type Availability = z.infer<typeof availabilitySchema>;

export const enrollmentSchema = z.object({
  id: z.string().uuid(),
  user_id: z.string().uuid(),
  program_id: z.string().uuid(),
  program_title: z.string(),
  version_id: z.string().uuid(),
  organization_id: z.string().uuid().nullable(),
  offering_id: z.string().uuid().nullable(),
  starts_at: z.string(),
  due_at: z.string(),
  access_ends_at: z.string().nullable(),
  state: z.enum(["not_started", "in_progress", "completed", "cancelled"]),
  availability: availabilitySchema,
  required_completed: z.number(),
  required_total: z.number(),
  progress_percent: z.union([z.number(), z.string()]).transform(Number),
  started_at: z.string().nullable(),
  last_activity_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  continue_class_id: z.string().uuid().nullable(),
  certificate_id: z.string().uuid().nullable(),
});

export type Enrollment = z.infer<typeof enrollmentSchema>;

export const outlineClassSchema = z.object({
  id: z.string().uuid(),
  module_id: z.string().uuid(),
  title: z.string(),
  kind: z.enum(["video", "audio", "text"]),
  position: z.number(),
  required: z.boolean(),
  completed: z.boolean(),
});

export const enrollmentDetailSchema = z.object({
  enrollment: enrollmentSchema,
  modules: z.array(
    z.object({
      id: z.string().uuid(),
      version_id: z.string().uuid(),
      title: z.string(),
      position: z.number(),
    })
  ),
  classes: z.array(outlineClassSchema),
});

export type EnrollmentDetail = z.infer<typeof enrollmentDetailSchema>;

export const classDetailSchema = z.object({
  class: z.object({
    id: z.string().uuid(),
    module_id: z.string().uuid(),
    version_id: z.string().uuid(),
    title: z.string(),
    kind: z.enum(["video", "audio", "text"]),
    required: z.boolean(),
    position: z.number(),
    body_md: z.string(),
    source_text: z.string(),
    duration_ms: z.union([z.number(), z.string()]).nullable(),
    primary_asset_id: z.string().uuid().nullable(),
  }),
  assets: z.array(
    z.object({
      id: z.string().uuid(),
      class_id: z.string().uuid(),
      role: z.enum(["primary", "handout", "caption", "transcript"]),
      original_name: z.string(),
      mime_type: z.string(),
      bytes: z.union([z.number(), z.string()]),
      state: z.enum(["pending", "ready", "failed"]),
      error_code: z.string().nullable(),
    })
  ),
  exercise: z
    .object({
      id: z.string().uuid(),
      class_id: z.string().uuid(),
      instructions_md: z.string(),
    })
    .nullable(),
  saved_response: z.string().nullable(),
  progress: z.object({
    class_id: z.string().uuid(),
    position_ms: z.union([z.number(), z.string()]).transform(Number),
    coverage_ms: z.union([z.number(), z.string()]).transform(Number),
    content_complete: z.boolean(),
    exercise_complete: z.boolean(),
    class_complete: z.boolean(),
    required_completed: z.number(),
    required_total: z.number(),
    certificate_id: z.string().uuid().nullable(),
  }),
});

export type ClassDetail = z.infer<typeof classDetailSchema>;

export async function listMyEnrollments(): Promise<Enrollment[]> {
  const result = await callRpc<{ items: unknown[] }>("list_my_enrollments", {});
  return z.array(enrollmentSchema).parse(result.items);
}

export async function getEnrollment(enrollmentId: string): Promise<EnrollmentDetail> {
  return enrollmentDetailSchema.parse(
    await callRpc("get_enrollment", { enrollment_id: enrollmentId })
  );
}

export async function getLearningClass(
  enrollmentId: string,
  classId: string
): Promise<ClassDetail> {
  return classDetailSchema.parse(
    await callRpc("get_learning_class", { enrollment_id: enrollmentId, class_id: classId })
  );
}

/**
 * spec/04: "locked card gives reason, no player". Each availability value gets
 * a sentence a learner can act on, rather than the enum name — "revoked" tells
 * somebody nothing about who to ask.
 */
export function availabilityReason(availability: Availability): string | null {
  switch (availability) {
    case "available":
      return null;
    case "not_started":
      return "This program has not opened yet.";
    case "expired":
      return "Access to this program has ended. Your record stays available.";
    case "revoked":
      return "Your organization's access to this program has ended.";
    case "membership_inactive":
      return "You are no longer an active member of this organization.";
    case "cancelled":
      return "This assignment was cancelled. Your progress has been kept.";
    case "account_inactive":
      return "Your account is not active. Ask your administrator.";
  }
}

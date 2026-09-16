import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { toCsv, type CsvColumn } from "@/lib/csv";

/* contracts/api.json: Report, ReportRow and ReportSummary. */

export const reportRowSchema = z.object({
  enrollment_id: z.string().uuid(),
  organization: z.string().nullable(),
  cohort: z.string().nullable(),
  program: z.string(),
  version_number: z.number().int().min(1),
  learner_name: z.string(),
  learner_email: z.string(),
  invitation_state: z.enum(["pending", "accepted", "expired", "cancelled", "none"]),
  state: z.enum(["not_started", "in_progress", "completed", "cancelled"]),
  availability: z.enum([
    "available", "not_started", "expired", "revoked",
    "membership_inactive", "cancelled", "account_inactive",
  ]),
  starts_at: z.string(),
  due_at: z.string(),
  access_ends_at: z.string().nullable(),
  required_completed: z.number().int().min(0),
  required_total: z.number().int().min(1),
  progress_percent: z.union([z.number(), z.string()]).transform(Number),
  last_activity_at: z.string().nullable(),
  completed_at: z.string().nullable(),
  on_time: z.boolean().nullable(),
  certificate_id: z.string().uuid().nullable(),
  timezone: z.string(),
});

export type ReportRow = z.infer<typeof reportRowSchema>;

const nullableNumber = z.union([z.number(), z.string(), z.null()]).transform((v) =>
  v === null ? null : Number(v)
);

export const reportSummarySchema = z.object({
  assigned: z.union([z.number(), z.string()]).transform(Number),
  not_started: z.union([z.number(), z.string()]).transform(Number),
  in_progress: z.union([z.number(), z.string()]).transform(Number),
  completed: z.union([z.number(), z.string()]).transform(Number),
  overdue: z.union([z.number(), z.string()]).transform(Number),
  // Null when there is nothing to divide by — not zero (spec/03).
  completion_rate: nullableNumber,
  average_progress: nullableNumber,
});

export const reportSchema = z.object({
  summary: reportSummarySchema,
  items: z.array(reportRowSchema),
  next_cursor: z.string().nullable(),
});

export type Report = z.infer<typeof reportSchema>;

/** Every filter the contract declares, all optional. */
export const reportFilterSchema = z
  .object({
    organization_id: z.string().uuid().optional(),
    offering_id: z.string().uuid().optional(),
    state: z.enum(["not_started", "in_progress", "completed", "cancelled"]).optional(),
    overdue: z.boolean().optional(),
    completed_from: z.string().optional(),
    completed_to: z.string().optional(),
    cursor: z.string().optional(),
    limit: z.number().int().min(1).max(100).optional(),
  })
  .strict();

export type ReportFilters = z.infer<typeof reportFilterSchema>;

export async function reportEnrollments(filters: ReportFilters): Promise<Report> {
  return reportSchema.parse(await callRpc("report_enrollments", filters));
}

/*
 * The CSV's columns, in the order ReportRow declares them — spec/03: "Header
 * order matches API ReportRow schema."
 *
 * `userEntered` marks the fields somebody typed, which are the only ones
 * defended against spreadsheet formula injection. A timestamp or a uuid cannot
 * begin with `=`, and prefixing one would corrupt it.
 */
export const REPORT_COLUMNS: readonly CsvColumn<ReportRow>[] = [
  { header: "enrollment_id", value: (r) => r.enrollment_id },
  { header: "organization", value: (r) => r.organization, userEntered: true },
  { header: "cohort", value: (r) => r.cohort, userEntered: true },
  { header: "program", value: (r) => r.program, userEntered: true },
  { header: "version_number", value: (r) => r.version_number },
  { header: "learner_name", value: (r) => r.learner_name, userEntered: true },
  { header: "learner_email", value: (r) => r.learner_email, userEntered: true },
  { header: "invitation_state", value: (r) => r.invitation_state },
  { header: "state", value: (r) => r.state },
  { header: "availability", value: (r) => r.availability },
  { header: "starts_at", value: (r) => r.starts_at },
  { header: "due_at", value: (r) => r.due_at },
  { header: "access_ends_at", value: (r) => r.access_ends_at },
  { header: "required_completed", value: (r) => r.required_completed },
  { header: "required_total", value: (r) => r.required_total },
  { header: "progress_percent", value: (r) => r.progress_percent },
  { header: "last_activity_at", value: (r) => r.last_activity_at },
  { header: "completed_at", value: (r) => r.completed_at },
  { header: "on_time", value: (r) => r.on_time },
  { header: "certificate_id", value: (r) => r.certificate_id },
  { header: "timezone", value: (r) => r.timezone },
];

export async function exportEnrollments(filters: ReportFilters): Promise<string> {
  const result = z
    .object({ items: z.array(reportRowSchema), total: z.union([z.number(), z.string()]) })
    .parse(await callRpc("export_enrollments", filters));
  return toCsv(REPORT_COLUMNS, result.items);
}

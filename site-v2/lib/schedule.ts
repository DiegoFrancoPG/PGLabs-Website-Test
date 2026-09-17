/*
 * Derived learning state and the date boundaries around it.
 *
 * spec/03: "Derived learning state: cancelled if status cancelled; otherwise
 * completed if completed_at exists; otherwise in_progress if started_at exists;
 * else not_started. Availability is independent (security spec). At t=due
 * incomplete is not overdue; t>due is overdue. Completion exactly at due is on
 * time. Completion after due is allowed if still accessible. At t=hard-end no
 * new learning write is accepted."
 *
 * ADR-10 fixes the asymmetry these rules turn on: **start is inclusive, the
 * hard access end is exclusive, and due is inclusive for on-time completion.**
 * Each boundary is therefore decided by a different comparison, and getting one
 * of them backwards is exactly the kind of mistake that only shows up on the
 * day a cohort's deadline lands.
 *
 * This module is pure. Access itself is decided in the database, which checks
 * the current grant on every request — nothing here grants anything.
 */

export type LearningState = "not_started" | "in_progress" | "completed" | "cancelled";

export interface EnrollmentSchedule {
  status: "active" | "cancelled";
  startsAt: Date | string;
  dueAt: Date | string;
  accessEndsAt: Date | string | null;
  startedAt: Date | string | null;
  completedAt: Date | string | null;
}

function ms(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function learningState(enrollment: EnrollmentSchedule): LearningState {
  if (enrollment.status === "cancelled") return "cancelled";
  if (enrollment.completedAt) return "completed";
  if (enrollment.startedAt) return "in_progress";
  return "not_started";
}

/** Start is INCLUSIVE: at exactly the start moment, learning may begin. */
export function hasStarted(enrollment: EnrollmentSchedule, now: Date | string): boolean {
  return ms(now) >= ms(enrollment.startsAt);
}

/**
 * The hard access end is EXCLUSIVE: at exactly that moment no new learning
 * write is accepted, which is the opposite of how the start behaves.
 */
export function accessHasEnded(enrollment: EnrollmentSchedule, now: Date | string): boolean {
  if (enrollment.accessEndsAt == null) return false;
  return ms(now) >= ms(enrollment.accessEndsAt);
}

/**
 * Due is INCLUSIVE. At exactly the due moment an incomplete enrollment is not
 * yet overdue; a millisecond later it is.
 */
export function isOverdue(enrollment: EnrollmentSchedule, now: Date | string): boolean {
  if (enrollment.status === "cancelled") return false;
  if (enrollment.completedAt) return false;
  return ms(now) > ms(enrollment.dueAt);
}

/**
 * Whether a completion counted as on time. Completing exactly at the due
 * moment is on time; later is late but still permitted while access lasts.
 */
export function completedOnTime(enrollment: EnrollmentSchedule): boolean | null {
  if (!enrollment.completedAt) return null;
  return ms(enrollment.completedAt) <= ms(enrollment.dueAt);
}

/** Whether a new learning write may be accepted, on dates alone. */
export function acceptsLearningWrites(
  enrollment: EnrollmentSchedule,
  now: Date | string
): boolean {
  if (enrollment.status === "cancelled") return false;
  return hasStarted(enrollment, now) && !accessHasEnded(enrollment, now);
}

/**
 * Progress over the REQUIRED classes only, which is the denominator the
 * published freeze exists to keep stable.
 */
export function progressPercent(requiredCompleted: number, requiredTotal: number): number {
  if (requiredTotal <= 0) return 0;
  return Math.round((requiredCompleted / requiredTotal) * 1000) / 10;
}

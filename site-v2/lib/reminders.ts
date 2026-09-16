/*
 * Which reminder a learner is due, and when it may be sent.
 *
 * spec/03 §6: "Fixed priority: overdue > due_today > due_soon > inactivity;
 * choose earliest due then enrollment UUID as tie break. Learner local date
 * uses profile.timezone. Eligible sending hours are 09:00 through 17:59 local;
 * next hourly run catches a missed window, without backdating prior-day sends.
 *
 * Eligibility: active accessible enrollment and profile, onboarded,
 * reminders_enabled, not completed, not cancelled. Inactivity when
 * now-max(last_activity_at,starts_at)>=72 hours; repeat after >=7 days since
 * last accepted inactivity send. Due_soon when local due date minus current
 * local date=3. Due_today when same date and now<=due. Overdue once when
 * now>due. Due-date campaign key includes due_at; changing due starts a new
 * campaign. Inactivity key includes the 7-day interval number anchored at
 * max(last_activity_at,starts_at)+72 hours."
 *
 * Everything here is pure and takes its clock as an argument, so the rules can
 * be evaluated at 08:59 and 09:00 on a day the offset changes without waiting
 * for that day to arrive. The database decides eligibility of the enrollment
 * itself; this decides which rule and which local date.
 */

export type ReminderRule = "overdue" | "due_today" | "due_soon" | "inactivity";

/** spec/03's fixed priority. Lower wins. */
export const RULE_PRIORITY: Record<ReminderRule, number> = {
  overdue: 0,
  due_today: 1,
  due_soon: 2,
  inactivity: 3,
};

export const FIRST_SENDING_HOUR = 9;
export const LAST_SENDING_HOUR = 17; // 17:59 is still inside the window.
export const INACTIVITY_AFTER_MS = 72 * 60 * 60 * 1000;
export const INACTIVITY_REPEAT_MS = 7 * 24 * 60 * 60 * 1000;
export const DUE_SOON_DAYS = 3;

/*
 * A learner's wall clock, in their own timezone.
 *
 * Intl is the only thing in the platform that knows that Europe/Madrid was
 * +01:00 in January and +02:00 in July. Doing this with an offset number would
 * be wrong twice a year — and wrong in the direction that sends somebody two
 * reminders on the day the clocks go back, which is exactly what AC-046 tests.
 */
export interface LocalMoment {
  /** ISO local date, YYYY-MM-DD. */
  date: string;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    formatters.set(timezone, formatter);
  }
  return formatter;
}

export function localMoment(instant: Date | string, timezone: string): LocalMoment {
  const at = instant instanceof Date ? instant : new Date(instant);
  const parts = formatterFor(timezone).formatToParts(at);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  // en-CA gives an ISO-shaped date, so the parts assemble without arithmetic.
  return {
    date: `${value("year")}-${value("month")}-${value("day")}`,
    // Some locales render midnight as 24; normalise it to 0.
    hour: Number(value("hour")) % 24,
    minute: Number(value("minute")),
  };
}

/** spec/03: "Eligible sending hours are 09:00 through 17:59 local". */
export function withinSendingHours(moment: LocalMoment): boolean {
  return moment.hour >= FIRST_SENDING_HOUR && moment.hour <= LAST_SENDING_HOUR;
}

/** Whole days between two ISO local dates. Calendar days, not 24-hour periods. */
export function daysBetween(fromDate: string, toDate: string): number {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

export interface ReminderCandidate {
  enrollmentId: string;
  timezone: string;
  dueAt: string;
  startsAt: string;
  lastActivityAt: string | null;
  /** When an inactivity reminder was last accepted for this learner. */
  lastInactivityAt: string | null;
}

export interface ReminderChoice {
  rule: ReminderRule;
  campaignKey: string;
  eventKey: string;
  localDate: string;
}

/** spec/03: "Event key is `learning/{enrollment_id}/{rule}/{campaign_key}`." */
export function eventKey(enrollmentId: string, rule: ReminderRule, campaignKey: string): string {
  return `learning/${enrollmentId}/${rule}/${campaignKey}`;
}

/**
 * The rule this enrollment is due, or null.
 *
 * The caller has already established that the enrollment is active, accessible,
 * incomplete and that the learner wants reminders — those are the database's
 * to decide, and it re-decides them immediately before sending.
 */
export function ruleFor(
  candidate: ReminderCandidate,
  now: Date | string
): ReminderChoice | null {
  const at = now instanceof Date ? now : new Date(now);
  const local = localMoment(at, candidate.timezone);
  const dueLocal = localMoment(candidate.dueAt, candidate.timezone);
  const dueMs = Date.parse(candidate.dueAt);

  /*
   * The due-date campaign key carries the due date itself, so moving a
   * deadline starts a new campaign and the learner is told about the new one.
   * spec/03: "changing due starts a new campaign."
   */
  const dueCampaign = candidate.dueAt;

  // Overdue: "once when now>due". Due is inclusive, so exactly at due is not.
  if (at.getTime() > dueMs) {
    return {
      rule: "overdue",
      campaignKey: dueCampaign,
      eventKey: eventKey(candidate.enrollmentId, "overdue", dueCampaign),
      localDate: local.date,
    };
  }

  // Due today: "same date and now<=due".
  if (local.date === dueLocal.date) {
    return {
      rule: "due_today",
      campaignKey: dueCampaign,
      eventKey: eventKey(candidate.enrollmentId, "due_today", dueCampaign),
      localDate: local.date,
    };
  }

  // Due soon: "local due date minus current local date=3". Exactly three.
  if (daysBetween(local.date, dueLocal.date) === DUE_SOON_DAYS) {
    return {
      rule: "due_soon",
      campaignKey: dueCampaign,
      eventKey: eventKey(candidate.enrollmentId, "due_soon", dueCampaign),
      localDate: local.date,
    };
  }

  // Inactivity, last: "now-max(last_activity_at,starts_at)>=72 hours".
  const anchor = Math.max(
    Date.parse(candidate.startsAt),
    candidate.lastActivityAt ? Date.parse(candidate.lastActivityAt) : 0
  );
  // Before the enrollment starts there is nothing to be inactive about.
  if (at.getTime() < Date.parse(candidate.startsAt)) return null;

  const idleFor = at.getTime() - anchor;
  if (idleFor < INACTIVITY_AFTER_MS) return null;

  /*
   * "repeat after >=7 days since last accepted inactivity send", and the key
   * "includes the 7-day interval number anchored at max(...)+72 hours". The
   * interval number is what makes the second nudge a different campaign from
   * the first rather than a duplicate of it.
   */
  if (candidate.lastInactivityAt) {
    const since = at.getTime() - Date.parse(candidate.lastInactivityAt);
    if (since < INACTIVITY_REPEAT_MS) return null;
  }

  const interval = Math.floor((idleFor - INACTIVITY_AFTER_MS) / INACTIVITY_REPEAT_MS);
  const campaignKey = `${new Date(anchor + INACTIVITY_AFTER_MS).toISOString()}#${interval}`;
  return {
    rule: "inactivity",
    campaignKey,
    eventKey: eventKey(candidate.enrollmentId, "inactivity", campaignKey),
    localDate: local.date,
  };
}

/**
 * The one reminder a learner gets today, from everything they are due.
 *
 * spec/03: "Fixed priority: overdue > due_today > due_soon > inactivity; choose
 * earliest due then enrollment UUID as tie break." The daily cap is one
 * LEARNING message; invitations and certificates do not consume it.
 */
export function highestPriority(
  choices: { candidate: ReminderCandidate; choice: ReminderChoice }[]
): { candidate: ReminderCandidate; choice: ReminderChoice } | null {
  if (choices.length === 0) return null;
  return [...choices].sort((a, b) => {
    const byRule = RULE_PRIORITY[a.choice.rule] - RULE_PRIORITY[b.choice.rule];
    if (byRule !== 0) return byRule;
    const byDue = Date.parse(a.candidate.dueAt) - Date.parse(b.candidate.dueAt);
    if (byDue !== 0) return byDue;
    return a.candidate.enrollmentId.localeCompare(b.candidate.enrollmentId);
  })[0];
}

/*
 * The retry schedule. spec/03: "Retry eligible failures after 1,5,15,60
 * minutes, maximum five attempts total."
 */
export const RETRY_DELAYS_MS = [60_000, 300_000, 900_000, 3_600_000] as const;
export const MAX_ATTEMPTS = 5;
/** "after 23 hours from first attempt, move unknown outcome to uncertain". */
export const UNCERTAIN_AFTER_MS = 23 * 60 * 60 * 1000;

export function nextAttemptAt(attempts: number, from: Date | string): Date | null {
  if (attempts >= MAX_ATTEMPTS) return null;
  const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)];
  const base = from instanceof Date ? from.getTime() : Date.parse(from);
  return new Date(base + delay);
}

/*
 * Checks an assignment's dates against the rules the database enforces
 * (M01 checks and the M02 offering trigger), before anything is sent.
 */

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));

/*
 * The database refuses an assignment that breaks one of these rules, but its
 * reason is not returned to the browser (spec/05) — the manager only saw
 * "The request could not be completed." So they are checked here first, in
 * words that say what to change.
 */
export function assignmentProblem(
  grant: { startsAt?: string; endsAt?: string | null },
  starts: string,
  due: string,
  accessEnds: string | null
): string | null {
  if (Date.parse(due) <= Date.parse(starts)) return "The due date must be after the start date.";
  if (accessEnds && Date.parse(accessEnds) < Date.parse(due)) {
    return "Access cannot end before the due date.";
  }
  if (grant.startsAt && Date.parse(starts) < Date.parse(grant.startsAt)) {
    return `This organization has access to the program from ${shortDate(grant.startsAt)}. Start on or after that date.`;
  }
  if (grant.endsAt && Date.parse(accessEnds ?? due) > Date.parse(grant.endsAt)) {
    return `This organization's access to the program ends ${shortDate(grant.endsAt)}. Choose ${
      accessEnds ? "an access end" : "a due date"
    } before then, or ask PG Labs to extend the access.`;
  }
  return null;
}

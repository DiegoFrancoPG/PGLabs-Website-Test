/*
 * Module release dates (M31, D-08), as the pages need them. The database is
 * what keeps a held-back lesson closed; these only decide what to show.
 */

/** Whether a module with this release date is still held back at `now`. */
export function isHeldBack(releaseAt: string | null | undefined, now: Date | string): boolean {
  if (!releaseAt) return false;
  return Date.parse(releaseAt) > new Date(now).getTime();
}

/** "Nov 3, 2026" — or with the time when it is not midnight in that zone. */
export function formatRelease(releaseAt: string, timezone: string): string {
  const date = new Date(releaseAt);
  const time = new Intl.DateTimeFormat("en-CA", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone,
  }).format(date);
  const day = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: timezone }).format(date);
  return time === "00:00" ? day : `${day}, ${new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: timezone }).format(date)}`;
}

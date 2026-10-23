"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/pglearn/ui/alert";
import { Button } from "@/components/pglearn/ui/button";

/*
 * Changing an assigned program's dates (D-17).
 *
 * The dates belong to the assignment (the offering) and are copied into each
 * person's enrollment, so a change goes to both: update_offering moves the
 * offering and the enrollments it is told about. Those are everybody still
 * learning; a completed enrollment keeps its dates (spec/02: "Completed
 * enrollment schedules cannot be edited in v1").
 *
 * Only the dates the manager changed are sent. In particular an unchanged
 * start is left alone, because the start cannot move past the day somebody
 * already began.
 */

export interface ProgramSchedule {
  offeringId: string;
  programTitle: string;
  version: number | null;
  startsAt: string;
  dueAt: string;
  accessEndsAt: string | null;
  /** Enrollments still in progress or not started: the ones that take new dates. */
  openEnrollmentIds: string[];
  people: number;
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "");

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-CA", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(iso));
}

export function ProgramDates({ schedule }: { schedule: ProgramSchedule }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [startsAt, setStartsAt] = useState(day(schedule.startsAt));
  const [dueAt, setDueAt] = useState(day(schedule.dueAt));
  const [accessEndsAt, setAccessEndsAt] = useState(day(schedule.accessEndsAt));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const patch: Record<string, string | null> = {};
    if (startsAt !== day(schedule.startsAt)) patch.starts_at = `${startsAt}T00:00:00.000Z`;
    if (dueAt !== day(schedule.dueAt)) patch.due_at = `${dueAt}T23:59:59.000Z`;
    if (accessEndsAt !== day(schedule.accessEndsAt)) {
      patch.access_ends_at = accessEndsAt ? `${accessEndsAt}T00:00:00.000Z` : null;
    }
    if (Object.keys(patch).length === 0) {
      setOpen(false);
      return;
    }
    if (dueAt < startsAt) {
      setError("The due date cannot be before the start.");
      return;
    }

    setPending(true);
    try {
      // The contract takes at most 100 enrollments a call; the offering's dates
      // are set again identically by each.
      const ids = schedule.openEnrollmentIds;
      const batches: string[][] = ids.length === 0 ? [[]] : [];
      for (let i = 0; i < ids.length; i += 100) batches.push(ids.slice(i, i + 100));
      for (const batch of batches) {
        const response = await fetch(`/api/v1/offerings/${schedule.offeringId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ ...patch, apply_to_enrollment_ids: batch }),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          const message: string = body?.error?.message ?? "";
          throw new Error(
            message.includes("start cannot move")
              ? "Somebody has already started, so the start cannot move later than the day they began."
              : message || "The dates could not be changed."
          );
        }
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="min-w-0 flex-1">
          <span className="font-semibold text-ui-foreground">{schedule.programTitle}</span>
          {schedule.version !== null && (
            <span className="text-ui-muted-foreground"> · version {schedule.version}</span>
          )}
          <span className="text-ui-muted-foreground">
            {" "}
            · {schedule.people} {schedule.people === 1 ? "person" : "people"}
          </span>
          <br />
          <span className="text-ui-body text-ui-muted-foreground">
            Starts {formatDate(schedule.startsAt)} · Due {formatDate(schedule.dueAt)} · Access ends{" "}
            {schedule.accessEndsAt ? formatDate(schedule.accessEndsAt) : "never"}
          </span>
        </span>
        {!open && (
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
            Edit dates
          </Button>
        )}
      </div>

      {open && (
        <form onSubmit={save} className="mt-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <DateField id={`starts-${schedule.offeringId}`} label="Starts" value={startsAt} onChange={setStartsAt} required />
            <DateField id={`due-${schedule.offeringId}`} label="Due" value={dueAt} onChange={setDueAt} required />
            <DateField
              id={`access-${schedule.offeringId}`}
              label="Access ends (optional)"
              value={accessEndsAt}
              onChange={setAccessEndsAt}
            />
          </div>
          <p className="mt-2 text-ui-body text-ui-muted-foreground">
            Applies to everybody still working on this program. People who have completed it keep their dates.
          </p>
          <div className="mt-3 flex gap-3">
            <Button type="submit" variant="primary" size="sm" disabled={pending || !startsAt || !dueAt}>
              {pending ? "Saving…" : "Save dates"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          {error && (
            <Alert variant="warning" className="mt-3" role="alert">
              {error}
            </Alert>
          )}
        </form>
      )}
    </li>
  );
}

function DateField({
  id,
  label,
  value,
  onChange,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-ui-eyebrow uppercase text-ui-muted-foreground">
        {label}
      </label>
      <input
        id={id}
        type="date"
        required={required}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full pglearn-field"
      />
    </div>
  );
}

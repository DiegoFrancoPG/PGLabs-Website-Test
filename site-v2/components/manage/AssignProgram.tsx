"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@ds/components/ui/alert";
import { Button } from "@ds/components/ui/button";
import { Card } from "@ds/components/ui/card";

/*
 * Assigning a program to some of a cohort.
 *
 * Two steps, because the contract has two: an offering carries the dates and
 * the version, and enrolment names the people. The screen presents them as one
 * decision, which is how a manager thinks about it.
 *
 * spec/04: "assignment confirmation states count and dates" — so the result
 * says how many people were enrolled and by when, rather than "done".
 */

interface Grant {
  id: string;
  programId: string;
  programTitle: string;
  /** The version this grant would assign: the program's latest published one. */
  versionId: string | null;
}

interface Member {
  userId: string;
  name: string;
  email: string;
}

export function AssignProgram({
  cohortId,
  grants,
  members,
}: {
  cohortId: string;
  grants: Grant[];
  members: Member[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const assignable = grants.filter((grant) => grant.versionId !== null);
  const [grantId, setGrantId] = useState(assignable[0]?.id ?? "");
  const [startsAt, setStartsAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueAt, setDueAt] = useState("");
  const [accessEndsAt, setAccessEndsAt] = useState("");
  const [selected, setSelected] = useState<string[]>(members.map((member) => member.userId));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function assign(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setDone(null);
    try {
      const grant = assignable.find((candidate) => candidate.id === grantId);
      if (!grant?.versionId) throw new Error("Choose a program to assign.");

      const created = await fetch("/api/v1/offerings", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          /*
           * The cohort and the grant carry the organization and the programme
           * between them, so the contract's OfferingCreate has neither field —
           * sending them is refused rather than ignored, which is the API
           * rejecting unknown keys doing its job.
           */
          cohort_id: cohortId,
          version_id: grant.versionId,
          grant_id: grant.id,
          starts_at: `${startsAt}T00:00:00.000Z`,
          due_at: `${dueAt}T23:59:59.000Z`,
          access_ends_at: accessEndsAt ? `${accessEndsAt}T00:00:00.000Z` : null,
        }),
      });
      const offering = await created.json();
      if (!created.ok) {
        throw new Error(offering?.error?.message ?? "The assignment could not be created.");
      }

      const enrolled = await fetch(`/api/v1/offerings/${offering.data.id}/enrollments`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ user_ids: selected }),
      });
      const result = await enrolled.json();
      if (!enrolled.ok) {
        /*
         * spec/04: "all-or-nothing validation errors identify invalid
         * selections without exposing other org records." The handler names
         * which selections were wrong; it never says who they belong to.
         */
        const fields = (result?.error?.fields ?? []) as { path: string; message: string }[];
        throw new Error(
          fields.length > 0
            ? `${result.error.message} ${fields.map((f) => f.message).join(" ")}`
            : (result?.error?.message ?? "Nobody was enrolled.")
        );
      }

      setDone(
        `${result.data.created} of ${selected.length} selected learner${
          selected.length === 1 ? "" : "s"
        } enrolled, due ${dueAt}. Anybody already enrolled was left as they were.`
      );
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  if (assignable.length === 0 || members.length === 0) {
    return (
      <p className="text-body-sm text-steel-500">
        {members.length === 0
          ? "Add somebody to the roster before assigning learning."
          : "Every granted program is still a draft. Publish a version before assigning it."}
      </p>
    );
  }

  if (!open) {
    return (
      <Button type="button" variant="primary" size="sm" onClick={() => setOpen(true)}>
        Assign a program
      </Button>
    );
  }

  return (
    <Card className="p-5">
      <form onSubmit={assign}>
        <h3 className="font-display text-h5 text-ink-800">Assign a program</h3>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="assign-grant" className="block text-label uppercase text-steel-500">
              Program
            </label>
            <select
              id="assign-grant"
              value={grantId}
              onChange={(event) => setGrantId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-steel-300 p-2 text-body-sm"
            >
              {assignable.map((grant) => (
                <option key={grant.id} value={grant.id}>
                  {grant.programTitle}
                </option>
              ))}
            </select>
            {/*
              * The version assigned is the program's latest PUBLISHED one, and
              * is not a choice: the contract lists no versions, and assigning
              * anything else would mean typing a uuid. A learner stays on the
              * version they were enrolled in whatever is published later.
              */}
            <p className="mt-1 text-body-sm text-steel-500">
              The current published version is assigned.
            </p>
          </div>

          <div>
            <label htmlFor="assign-starts" className="block text-label uppercase text-steel-500">
              Starts
            </label>
            <input
              id="assign-starts"
              type="date"
              required
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
              className="mt-1 w-full rounded-lg border border-steel-300 p-2 text-body-sm"
            />
          </div>

          <div>
            <label htmlFor="assign-due" className="block text-label uppercase text-steel-500">
              Due
            </label>
            <input
              id="assign-due"
              type="date"
              required
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
              className="mt-1 w-full rounded-lg border border-steel-300 p-2 text-body-sm"
            />
          </div>

          <div>
            <label htmlFor="assign-access" className="block text-label uppercase text-steel-500">
              Access ends (optional)
            </label>
            <input
              id="assign-access"
              type="date"
              value={accessEndsAt}
              onChange={(event) => setAccessEndsAt(event.target.value)}
              className="mt-1 w-full rounded-lg border border-steel-300 p-2 text-body-sm"
            />
            <p className="mt-1 text-body-sm text-steel-500">
              After this date learning stops, even if the programme is unfinished.
            </p>
          </div>
        </div>

        <fieldset className="mt-5 border-0 p-0">
          <legend className="text-label uppercase text-steel-500">Who</legend>
          <div className="mt-2 flex flex-col gap-1">
            {members.map((member) => (
              <label key={member.userId} className="flex items-center gap-2 text-body-sm">
                <input
                  type="checkbox"
                  checked={selected.includes(member.userId)}
                  onChange={(event) =>
                    setSelected((current) =>
                      event.target.checked
                        ? [...current, member.userId]
                        : current.filter((id) => id !== member.userId)
                    )
                  }
                />
                {member.name} <span className="text-steel-500">{member.email}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="mt-5 flex gap-3">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={pending || selected.length === 0 || dueAt === "" || grantId === ""}
          >
            {pending ? "Assigning…" : `Assign to ${selected.length}`}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>

        <div role="status" aria-live="polite">
          {done && (
            <Alert variant="info" className="mt-4">
              {done}
            </Alert>
          )}
        </div>
        {error && (
          <Alert variant="warning" className="mt-4" role="alert">
            {error}
          </Alert>
        )}
      </form>
    </Card>
  );
}

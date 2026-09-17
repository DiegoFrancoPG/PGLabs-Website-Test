"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@ds/components/ui/alert";
import { Button } from "@ds/components/ui/button";

/*
 * Granting an organization access to a program.
 *
 * A grant is what makes assignment possible at all: without one, an
 * organization's manager can create cohorts but has nothing to assign. The
 * subject of a grant is immutable after creation (only its dates and status
 * can change), which is why this form is create-only.
 */
export function GrantAccess({
  organizationId,
  programs,
}: {
  organizationId: string;
  programs: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [startsAt, setStartsAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [endsAt, setEndsAt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function grant(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          program_id: programId,
          organization_id: organizationId,
          user_id: null,
          starts_at: `${startsAt}T00:00:00.000Z`,
          ends_at: endsAt ? `${endsAt}T00:00:00.000Z` : null,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "It could not be granted.");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  if (programs.length === 0) {
    return <span className="text-body-sm text-steel-500">No programs to grant yet.</span>;
  }

  if (!open) {
    return (
      <Button type="button" variant="subtle" size="sm" onClick={() => setOpen(true)}>
        Grant a program
      </Button>
    );
  }

  return (
    <form onSubmit={grant} className="w-full">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label
            htmlFor={`grant-program-${organizationId}`}
            className="block text-label uppercase text-steel-500"
          >
            Program
          </label>
          <select
            id={`grant-program-${organizationId}`}
            value={programId}
            onChange={(event) => setProgramId(event.target.value)}
            className="mt-1 rounded-lg border border-steel-300 p-2 text-body-sm"
          >
            {programs.map((program) => (
              <option key={program.id} value={program.id}>
                {program.title}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor={`grant-from-${organizationId}`}
            className="block text-label uppercase text-steel-500"
          >
            From
          </label>
          <input
            id={`grant-from-${organizationId}`}
            type="date"
            required
            value={startsAt}
            onChange={(event) => setStartsAt(event.target.value)}
            className="mt-1 rounded-lg border border-steel-300 p-2 text-body-sm"
          />
        </div>

        <div>
          <label
            htmlFor={`grant-until-${organizationId}`}
            className="block text-label uppercase text-steel-500"
          >
            Until (optional)
          </label>
          <input
            id={`grant-until-${organizationId}`}
            type="date"
            value={endsAt}
            onChange={(event) => setEndsAt(event.target.value)}
            className="mt-1 rounded-lg border border-steel-300 p-2 text-body-sm"
          />
        </div>

        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Granting…" : "Grant"}
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
  );
}

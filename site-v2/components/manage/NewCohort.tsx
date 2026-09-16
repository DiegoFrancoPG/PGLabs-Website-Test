"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@ds/components/ui/alert";
import { Button } from "@ds/components/ui/button";

/* A cohort is a group of learners assigned the same programme on the same dates. */
export function NewCohort({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/cohorts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ organization_id: organizationId, name }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "It could not be created.");
      router.push(`/manage/${organizationId}/cohorts/${json.data.id}`);
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        New cohort
      </Button>
    );
  }

  return (
    <form onSubmit={create} className="flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor="cohort-name" className="block text-label uppercase text-steel-500">
          Name
        </label>
        <input
          id="cohort-name"
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
          className="mt-1 rounded-lg border border-steel-300 p-2 text-body-sm"
        />
      </div>
      <Button type="submit" variant="primary" size="sm" disabled={pending}>
        {pending ? "Creating…" : "Create"}
      </Button>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
        Cancel
      </Button>
      {error && (
        <Alert variant="warning" className="mt-2 w-full" role="alert">
          {error}
        </Alert>
      )}
    </form>
  );
}

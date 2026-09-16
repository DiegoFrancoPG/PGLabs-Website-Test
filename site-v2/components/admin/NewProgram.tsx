"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@ds/components/ui/alert";
import { Button } from "@ds/components/ui/button";
import { Card } from "@ds/components/ui/card";

/*
 * Creating a program, which also creates its first draft version — one action,
 * because a program with no version is not something anybody can do anything
 * with.
 */
export function NewProgram() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId] = useState(() => crypto.randomUUID());

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/v1/programs", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
        body: JSON.stringify({ title, summary }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "It could not be created.");
      // Straight into the editor for the version it just made.
      router.push(`/admin/programs/${json.data.program.id}`);
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        New program
      </Button>
    );
  }

  return (
    <Card className="p-5">
      <form onSubmit={create}>
        <h2 className="font-display text-h5 text-ink-800">New program</h2>

        <label htmlFor="program-title" className="mt-4 block text-label uppercase text-steel-500">
          Title
        </label>
        <input
          id="program-title"
          name="title"
          required
          maxLength={160}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="mt-1 w-full rounded-lg border border-steel-300 p-2 text-body-sm"
        />

        <label htmlFor="program-summary" className="mt-4 block text-label uppercase text-steel-500">
          Summary
        </label>
        <textarea
          id="program-summary"
          name="summary"
          rows={3}
          maxLength={2000}
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          className="mt-1 w-full rounded-lg border border-steel-300 p-2 text-body-sm"
        />

        <div className="mt-5 flex gap-3">
          <Button type="submit" variant="primary" size="sm" disabled={pending || title.trim() === ""}>
            {pending ? "Creating…" : "Create program"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            Cancel
          </Button>
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

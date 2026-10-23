"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/pglearn/ui/alert";
import { Button } from "@/components/pglearn/ui/button";

/*
 * The program's own name and summary (D-19). The name is what learners and
 * managers see everywhere; a version's title is only the editor's label for
 * that version, so renaming a draft never renamed the program.
 */
export function EditProgram({ programId, title, summary }: { programId: string; title: string; summary: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [newTitle, setNewTitle] = useState(title);
  const [newSummary, setNewSummary] = useState(summary);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/programs/${programId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ title: newTitle.trim(), summary: newSummary }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error?.message ?? "It could not be saved.");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        Edit name and summary
      </Button>
    );
  }

  return (
    <form onSubmit={save} className="mt-3 flex flex-col gap-3">
      <div>
        <label htmlFor="program-title" className="block text-ui-eyebrow uppercase text-ui-muted-foreground">
          Name
        </label>
        <input
          id="program-title"
          value={newTitle}
          onChange={(event) => setNewTitle(event.target.value)}
          required
          maxLength={160}
          className="mt-1 w-full pglearn-field"
        />
        <p className="mt-1 text-ui-body text-ui-muted-foreground">
          Learners and managers see this name. Certificates already issued keep the name they were issued with.
        </p>
      </div>
      <div>
        <label htmlFor="program-summary" className="block text-ui-eyebrow uppercase text-ui-muted-foreground">
          Summary
        </label>
        <textarea
          id="program-summary"
          value={newSummary}
          onChange={(event) => setNewSummary(event.target.value)}
          maxLength={2000}
          rows={3}
          className="mt-1 w-full pglearn-field"
        />
      </div>
      <div className="flex gap-3">
        <Button type="submit" variant="primary" size="sm" disabled={pending || newTitle.trim() === ""}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(false);
            setNewTitle(title);
            setNewSummary(summary);
          }}
        >
          Cancel
        </Button>
      </div>
      {error && (
        <Alert variant="warning" role="alert">
          {error}
        </Alert>
      )}
    </form>
  );
}

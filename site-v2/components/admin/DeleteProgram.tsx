"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/pglearn/ui/alert";
import { Button } from "@/components/pglearn/ui/button";

/*
 * Deleting a program for good (D-18, M36). Unlike archiving, this removes the
 * program, every version and lesson, the organizations' access, and every
 * learner's enrollment, progress and certificate in it. The consequences are
 * spelled out and the title has to be typed back, which the database checks
 * too.
 */
export function DeleteProgram({ programId, title }: { programId: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const matches = typed.trim() === title.trim();

  async function remove(event: React.FormEvent) {
    event.preventDefault();
    if (!matches) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/programs/${programId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ confirm_title: typed }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? "Not permitted. If you are an administrator, the database update M36 may not be applied yet."
            : (json?.error?.message ?? "The program could not be deleted.")
        );
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="destructive" size="sm" onClick={() => setOpen(true)}>
        Delete
      </Button>
    );
  }

  return (
    <form onSubmit={remove} className="mt-4 w-full rounded-ui border border-ui-destructive p-4">
      <p className="font-semibold text-ui-foreground">Delete &ldquo;{title}&rdquo; permanently?</p>
      <p className="mt-1 text-ui-body text-ui-muted-foreground">
        This removes every version and lesson, its uploaded files, every organization&rsquo;s access to it, and
        every learner&rsquo;s enrollment, progress and certificate in it. It cannot be undone. To only stop new
        assignments, archive it instead.
      </p>
      <label
        htmlFor={`delete-${programId}`}
        className="mt-3 block text-ui-eyebrow uppercase text-ui-muted-foreground"
      >
        Type the program title to confirm
      </label>
      <input
        id={`delete-${programId}`}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        autoComplete="off"
        className="mt-1 w-full pglearn-field"
      />
      <div className="mt-3 flex flex-wrap gap-3">
        <Button type="submit" variant="destructive" size="sm" disabled={!matches || pending}>
          {pending ? "Deleting…" : "Delete permanently"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(false);
            setTyped("");
            setError(null);
          }}
        >
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

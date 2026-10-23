"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Alert } from "@/components/pglearn/ui/alert";
import { Button } from "@/components/pglearn/ui/button";

/*
 * Renaming a module (update_module). Works on a published version too: the
 * new name is kept beside the frozen module and shown in its place (M34,
 * D-14), so learners see it straight away and nothing they earned changes.
 */
export function RenameModule({ moduleId, title }: { moduleId: string; title: string }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (value.trim() === title) {
      setEditing(false);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/modules/${moduleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ title: value.trim() }),
      });
      const json = await response.json();
      if (response.status === 409) {
        // The frozen-content refusal: renaming a published module needs M34.
        throw new Error("Renaming a published module needs the database update M34. Run aplicar-m34.sql in Supabase, then try again.");
      }
      if (!response.ok) throw new Error(json?.error?.message ?? "The name could not be saved.");
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  if (!editing) {
    return (
      <Button
        type="button"
        variant="subtle"
        size="sm"
        onClick={() => {
          setValue(title);
          setEditing(true);
        }}
      >
        <Pencil aria-hidden />
        Rename<span className="sr-only"> {title}</span>
      </Button>
    );
  }

  return (
    <form onSubmit={save} className="flex w-full flex-wrap items-center gap-2">
      <label htmlFor={`rename-${moduleId}`} className="sr-only">
        Module name
      </label>
      <input
        id={`rename-${moduleId}`}
        required
        maxLength={160}
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        className="min-w-[16rem] flex-1 pglearn-field"
      />
      <Button type="submit" variant="primary" size="sm" disabled={pending || !value.trim()}>
        {pending ? "Saving…" : "Save"}
      </Button>
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {error && (
        <Alert variant="warning" className="w-full" role="alert">
          {error}
        </Alert>
      )}
    </form>
  );
}

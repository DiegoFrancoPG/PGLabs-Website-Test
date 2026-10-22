"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EyeOff, Eye, Trash2 } from "lucide-react";
import { Alert } from "@/components/pglearn/ui/alert";
import { Button } from "@/components/pglearn/ui/button";

/*
 * Removing a module (M32, D-11). In a draft it is deleted with its lessons
 * (delete_module). A published version is frozen, so there it is hidden
 * instead (set_module_hidden): learners stop seeing it, its required lessons
 * stop counting, and anybody who had finished everything else completes the
 * program and gets their certificate. Both ask once before acting; showing a
 * hidden module again does not.
 */
export function RemoveModule({
  moduleId,
  title,
  published,
  hidden,
}: {
  moduleId: string;
  title: string;
  published: boolean;
  hidden: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, method: string, body: unknown) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const json = await response.json();
      if (response.status === 403) {
        // Only admins reach the editor: a refusal means M32 is not applied.
        throw new Error("Removing modules needs the database update M32. Run aplicar-m32.sql in Supabase, then try again.");
      }
      if (!response.ok) throw new Error(json?.error?.message ?? "It could not be changed.");
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  const remove = () =>
    published
      ? call(`/api/v1/modules/${moduleId}/hidden`, "PUT", { hidden: true })
      : call(`/api/v1/modules/${moduleId}`, "DELETE", {});

  if (published && hidden) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => call(`/api/v1/modules/${moduleId}/hidden`, "PUT", { hidden: false })}>
          <Eye aria-hidden />
          {pending ? "Showing…" : "Show module"}
          <span className="sr-only"> {title}</span>
        </Button>
        {error && <span className="text-ui-body text-ui-destructive">{error}</span>}
      </div>
    );
  }

  if (!confirming) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        {published ? <EyeOff aria-hidden /> : <Trash2 aria-hidden />}
        {published ? "Hide module" : "Delete module"}
        <span className="sr-only"> {title}</span>
      </Button>
    );
  }

  return (
    <div className="w-full">
      <Alert variant="warning" role="alert">
        {published
          ? `Hide ${title}? Learners will stop seeing it and its lessons will no longer count towards finishing the program, so anyone who has done everything else completes it and gets their certificate now. Their progress on this module is kept, and you can show it again later.`
          : `Delete ${title} and all its lessons from this draft? This cannot be undone.`}
      </Alert>
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={remove}>
          {pending ? "Working…" : published ? "Hide module" : "Delete module"}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
      {error && (
        <Alert variant="warning" className="mt-3" role="alert">
          {error}
        </Alert>
      )}
    </div>
  );
}

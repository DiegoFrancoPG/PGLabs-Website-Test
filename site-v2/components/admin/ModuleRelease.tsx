"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { CalendarClock } from "lucide-react";
import { Alert } from "@/components/pglearn/ui/alert";
import { Button } from "@/components/pglearn/ui/button";

/*
 * A module's release date (set_module_release, M31). Editable on a published
 * version too: the date is a schedule, not part of the frozen content. Until
 * it passes, learners see the module tagged with the date and cannot open its
 * lessons; the database enforces that, not this form.
 *
 * The field is in the author's own timezone, as the browser reports it.
 */

/* An ISO instant as the value a datetime-local input expects, in local time. */
function toLocalInput(iso: string): string {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/* True in the browser, false while rendering on the server. */
const noSubscribe = () => () => {};
const useInBrowser = () => useSyncExternalStore(noSubscribe, () => true, () => false);

export function ModuleRelease({ moduleId, releaseAt }: { moduleId: string; releaseAt: string | null }) {
  const router = useRouter();
  // Null until the author types; until then the field shows the saved date.
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Local time is only known in the browser, so the field fills there rather
  // than rendering one value on the server and another after hydration.
  const inBrowser = useInBrowser();
  const saved = inBrowser && releaseAt ? toLocalInput(releaseAt) : "";
  const value = draft ?? saved;
  const zone = inBrowser ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";

  async function save(next: string | null) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/modules/${moduleId}/release`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ release_at: next }),
      });
      const json = await response.json();
      if (response.status === 403) {
        // Only admins reach this form, so a refusal here means the database
        // does not know set_module_release yet: M31 has not been applied.
        throw new Error(
          "Release dates need the database update M31. Run aplicar-m31.sql in Supabase, then try again."
        );
      }
      if (!response.ok) throw new Error(json?.error?.message ?? "The release date could not be saved.");
      setDraft(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  const id = `release-${moduleId}`;
  const changed = draft !== null && draft !== saved;

  return (
    <div className="mt-4 rounded-ui border border-ui-border p-4">
      <label htmlFor={id} className="flex items-center gap-2 text-ui-eyebrow uppercase text-ui-muted-foreground">
        <CalendarClock aria-hidden className="size-4" />
        Release date
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          id={id}
          type="datetime-local"
          value={value}
          onChange={(event) => setDraft(event.target.value)}
          className="pglearn-field"
        />
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={pending || !value || !changed}
          onClick={() => save(new Date(value).toISOString())}
        >
          {pending ? "Saving…" : "Save date"}
        </Button>
        {releaseAt && (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => save(null)}>
            Release now
          </Button>
        )}
      </div>
      <p className="mt-2 text-ui-caption text-ui-muted-foreground">
        {releaseAt
          ? "Learners see this module with its date and can open it from then on."
          : "No date: the module is open as soon as the program is."}
        {zone && ` Times are in ${zone}.`}
      </p>
      {error && (
        <Alert variant="warning" className="mt-3" role="alert">
          {error}
        </Alert>
      )}
    </div>
  );
}

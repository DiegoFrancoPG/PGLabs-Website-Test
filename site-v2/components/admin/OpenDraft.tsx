"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@ds/components/ui/alert";
import { Button } from "@ds/components/ui/button";

/*
 * Opens this program's draft, creating one if there is none.
 *
 * The button says "Open draft" rather than "New version" because that is what
 * it does either way: the endpoint returns an existing draft rather than
 * making a second one, so an author who navigated away comes back to their own
 * work rather than to an empty one.
 */
export function OpenDraft({ programId }: { programId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/programs/${programId}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: "{}",
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "The draft could not be opened.");
      router.push(`/admin/programs/${programId}/versions/${json.data.version.id}`);
    } catch (err) {
      setError((err as Error).message);
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="primary" size="sm" onClick={open} disabled={pending}>
        {pending ? "Opening…" : "Open draft"}
      </Button>
      {error && (
        <Alert variant="warning" className="mt-3" role="alert">
          {error}
        </Alert>
      )}
    </>
  );
}

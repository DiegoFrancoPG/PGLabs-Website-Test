"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@ds/components/ui/alert";
import { Button } from "@ds/components/ui/button";

/*
 * AC-030: a text class is completed by an explicit act, never by being read.
 * The event_id is generated once and reused on retry, so a double click or a
 * flaky connection cannot record two completions.
 */
export function MarkTextComplete({
  enrollmentId,
  classId,
  complete,
}: {
  enrollmentId: string;
  classId: string;
  complete: boolean;
}) {
  const router = useRouter();
  const [eventId] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (complete) {
    return (
      <p className="mt-8 text-body-sm text-steel-500">You marked this class as complete.</p>
    );
  }

  async function markComplete() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/enrollments/${enrollmentId}/classes/${classId}/text-completion`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: JSON.stringify({ event_id: eventId }),
        }
      );
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "It could not be saved.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-8">
      <Button type="button" variant="primary" onClick={markComplete} disabled={pending}>
        {pending ? "Saving…" : "Mark as complete"}
      </Button>
      {error && (
        <Alert variant="warning" className="mt-3">
          {error}
        </Alert>
      )}
    </div>
  );
}

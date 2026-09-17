"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@ds/components/ui/button";

/*
 * Sending a failed message again — deliberately, once, by somebody who has
 * looked at it. spec/03: "a deliberate fresh resend creates a linked audited
 * new event only after outcome review."
 *
 * A message with no confirmed outcome has no button at all; this component is
 * only rendered for failed and suppressed rows.
 */
export function RetryNotification({ notificationId }: { notificationId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/v1/operations/notifications/${notificationId}/retry`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": crypto.randomUUID(),
          },
          body: "{}",
        }
      );
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "It could not be queued.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={retry} disabled={pending}>
        {pending ? "Queuing…" : "Send again"}
      </Button>
      {error && <span className="ml-2 text-coral-600">{error}</span>}
    </>
  );
}

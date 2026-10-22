"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/pglearn/ui/alert";
import { Button } from "@/components/pglearn/ui/button";

/*
 * Removing a program from an organization's catalog, or putting it back.
 *
 * Removing is update_grant with status "revoked", never a delete: spec/03 has
 * the backend check the current grant on every request, so access stops at
 * once while enrollments, progress and certificates stay on record — and a
 * restore picks up where people left off. Removing asks once before it acts,
 * because it cuts off everybody learning that program in the organization.
 */
export function GrantStatus({
  grantId,
  programTitle,
  status,
}: {
  grantId: string;
  programTitle: string;
  status: "active" | "revoked";
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function change(next: "active" | "revoked") {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/grants/${grantId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ status: next }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "It could not be changed.");
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  if (status === "revoked") {
    return (
      <>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => change("active")}>
          {pending ? "Restoring…" : "Restore"}
          <span className="sr-only"> {programTitle}</span>
        </Button>
        {error && <span className="text-ui-body text-ui-destructive">{error}</span>}
      </>
    );
  }

  if (!confirming) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Remove<span className="sr-only"> {programTitle}</span>
      </Button>
    );
  }

  return (
    <div className="mt-2 w-full">
      <Alert variant="warning" role="alert">
        Remove {programTitle} from this organization? Managers will no longer be able to assign it,
        and everyone learning it here loses access to its lessons straight away. Their progress and
        certificates are kept, and you can restore the program later.
      </Alert>
      <div className="mt-3 flex gap-2">
        <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={() => change("revoked")}>
          {pending ? "Removing…" : "Remove program"}
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

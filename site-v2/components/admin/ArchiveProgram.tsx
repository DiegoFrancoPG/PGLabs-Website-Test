"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@ds/components/ui/button";

/*
 * Archiving hides a program from new assignments. It does not touch anybody's
 * existing enrollment, which is why the wording says so rather than asking
 * "are you sure?" about an unnamed consequence.
 */
export function ArchiveProgram({
  programId,
  archived,
}: {
  programId: string;
  archived: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/programs/${programId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ archived: !archived }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "It could not be changed.");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={toggle} disabled={pending}>
        {pending ? "Saving…" : archived ? "Restore" : "Archive"}
      </Button>
      {error && <span className="ml-2 text-body-sm text-coral-600">{error}</span>}
    </>
  );
}

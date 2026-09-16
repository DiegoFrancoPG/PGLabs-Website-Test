"use client";

import { useState } from "react";

/*
 * A handout is authorized at the moment it is asked for, never in advance
 * (AC-062). The URL this mints is short-lived and is not kept anywhere.
 */
export function HandoutLink({
  assetId,
  enrollmentId,
  name,
}: {
  assetId: string;
  enrollmentId: string;
  name: string;
}) {
  const [error, setError] = useState<string | null>(null);

  async function open() {
    setError(null);
    try {
      const response = await fetch(`/api/v1/assets/${assetId}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ enrollment_id: enrollmentId, preview: false }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "It could not be opened.");
      window.open(json.data.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="text-brand-600 underline underline-offset-4"
      >
        {name}
      </button>
      {error && <span className="ml-2 text-coral-600">{error}</span>}
    </>
  );
}

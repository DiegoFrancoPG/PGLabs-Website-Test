"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FlaskConical, RefreshCw } from "lucide-react";
import { Alert } from "@/components/pglearn/ui/alert";
import { Button } from "@/components/pglearn/ui/button";

/*
 * Test organizations (M33, D-13), for development. Marking one lets an admin
 * move its people on a program to the latest published version, which a real
 * organization can never do: there, people keep the version they started on.
 */

async function send(path: string, method: string, body: unknown) {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (response.status === 403) {
    // Only admins reach this page: a refusal means M33 is not applied.
    throw new Error("This needs the database update M33. Run aplicar-m33.sql in Supabase, then try again.");
  }
  if (!response.ok) throw new Error(json?.error?.message ?? "It could not be changed.");
  return json.data;
}

export function TestOrganizationToggle({
  organizationId,
  isTest,
}: {
  organizationId: string;
  isTest: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setPending(true);
    setError(null);
    try {
      await send(`/api/v1/organizations/${organizationId}/test`, "PUT", { is_test: !isTest });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={toggle}>
        <FlaskConical aria-hidden />
        {isTest ? "Unmark as test organization" : "Mark as test organization"}
      </Button>
      {error && <span className="text-ui-body text-ui-destructive">{error}</span>}
    </>
  );
}

export function MoveToLatest({
  organizationId,
  programId,
  programTitle,
}: {
  organizationId: string;
  programId: string;
  programTitle: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function move() {
    setPending(true);
    setError(null);
    setDone(null);
    try {
      const result = await send(`/api/v1/organizations/${organizationId}/move-to-latest`, "POST", {
        program_id: programId,
      });
      setDone(
        `${result.moved} ${result.moved === 1 ? "person" : "people"} moved to version ${result.version_number}` +
          (result.skipped_completed > 0
            ? `; ${result.skipped_completed} completed ${result.skipped_completed === 1 ? "enrollment" : "enrollments"} left as they were.`
            : ".")
      );
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="w-full">
      {confirming ? (
        <>
          <Alert variant="warning" role="alert">
            Move everyone in this test organization learning {programTitle} to its latest published
            version? Their progress is copied lesson by lesson by position; anything without a
            counterpart in the new version is lost. Completed enrollments are left as they are.
          </Alert>
          <div className="mt-2 flex gap-2">
            <Button type="button" variant="primary" size="sm" disabled={pending} onClick={move}>
              {pending ? "Moving…" : "Move to latest version"}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>
          <RefreshCw aria-hidden />
          Move to latest version<span className="sr-only"> ({programTitle})</span>
        </Button>
      )}
      <div role="status" aria-live="polite">
        {done && <p className="mt-1 text-ui-caption text-ui-muted-foreground">{done}</p>}
      </div>
      {error && (
        <Alert variant="warning" className="mt-2" role="alert">
          {error}
        </Alert>
      )}
    </div>
  );
}

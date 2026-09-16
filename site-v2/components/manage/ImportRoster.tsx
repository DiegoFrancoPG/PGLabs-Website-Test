"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { previewRoster, PROBLEM_TEXT, type RosterPreview } from "@/lib/roster";
import { Alert } from "@ds/components/ui/alert";
import { Badge } from "@ds/components/ui/badge";
import { Button } from "@ds/components/ui/button";
import { Card } from "@ds/components/ui/card";

/*
 * Importing a roster from a CSV: preview, then an explicit apply.
 *
 * spec/04 lists this under the deferred convenience screens — "CSV roster
 * import with preview/validation and explicit apply" — and T26's own note says
 * "No new API contract needed: apply uses existing idempotent routes with
 * per-row keys". So this invents nothing: it calls create_invitation once per
 * valid row and then add_cohort_members once, which are the same commands a
 * manager uses one person at a time.
 *
 * Two things make the apply safe to press twice:
 *
 *   - each row's Idempotency-Key is derived from the file's content and the
 *     row's address, so the SAME import applied again is the same request
 *     rather than a second invitation;
 *   - invitations are idempotent by normalized email anyway (T06), so even a
 *     different key does not create a second person.
 */

async function digest(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

/** A uuid-shaped key derived from the file and one address. */
async function keyFor(fileHash: string, email: string): Promise<string> {
  const hex = await digest(`${fileHash}:${email}`);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

interface Applied {
  invited: number;
  alreadyThere: number;
  added: number;
  failed: { email: string; reason: string }[];
}

export function ImportRoster({
  organizationId,
  cohortId,
}: {
  organizationId: string;
  cohortId: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<RosterPreview | null>(null);
  const [fileHash, setFileHash] = useState("");
  const [fileName, setFileName] = useState("");
  const [applying, setApplying] = useState(false);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function read(file: File) {
    setError(null);
    setApplied(null);
    try {
      const text = await file.text();
      setPreview(previewRoster(text));
      setFileHash(await digest(text));
      setFileName(file.name);
    } catch (err) {
      setPreview(null);
      setError((err as Error).message);
    }
  }

  async function apply() {
    if (!preview) return;
    setApplying(true);
    setError(null);

    const result: Applied = { invited: 0, alreadyThere: 0, added: 0, failed: [] };
    const userIds: string[] = [];

    try {
      for (const row of preview.valid) {
        const response = await fetch("/api/v1/invitations", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Derived, not random: applying the same file twice is the same
            // request each time.
            "Idempotency-Key": await keyFor(fileHash, row.email),
          },
          body: JSON.stringify({
            organization_id: organizationId,
            email: row.email,
            display_name: row.displayName,
            // A roster imports LEARNERS. A manager cannot promote anybody this
            // way, and the database refuses it independently.
            role: "learner",
          }),
        });
        const json = await response.json();

        if (!response.ok) {
          result.failed.push({
            email: row.email,
            reason: json?.error?.message ?? "It could not be invited.",
          });
          continue;
        }

        userIds.push(json.data.user_id);
        if (json.data.status === "accepted") result.alreadyThere += 1;
        else result.invited += 1;
      }

      if (userIds.length > 0) {
        const added = await fetch(`/api/v1/cohorts/${cohortId}/members`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": await keyFor(fileHash, "cohort-members"),
          },
          body: JSON.stringify({ user_ids: userIds }),
        });
        if (!added.ok) {
          const failure = await added.json();
          throw new Error(
            failure?.error?.message ?? "Everybody was invited, but the cohort was not updated."
          );
        }
        result.added = userIds.length;
      }

      setApplied(result);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept=".csv,text/csv"
        id={`roster-${cohortId}`}
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void read(file);
          event.target.value = "";
        }}
      />
      <Button type="button" variant="outline" size="sm" onClick={() => input.current?.click()}>
        Import a CSV
      </Button>

      {error && (
        <Alert variant="warning" className="mt-3" role="alert">
          {error}
        </Alert>
      )}

      {preview && !applied && (
        <Card className="mt-4 p-5">
          <h3 className="font-display text-h5 text-ink-800">{fileName}</h3>
          <p className="mt-2 text-body-sm">
            {preview.totals.rows} row{preview.totals.rows === 1 ? "" : "s"}:{" "}
            <strong>{preview.totals.valid}</strong> will be invited and added,{" "}
            <strong>{preview.totals.invalid}</strong> cannot be used.
          </p>
          <p className="mt-1 text-body-sm text-steel-500">
            Nothing has happened yet. Importing invites each person and puts them in this cohort —
            it does not assign them any learning.
          </p>

          {preview.invalid.length > 0 && (
            <div className="mt-4">
              <h4 className="text-label uppercase text-steel-500">Rows that cannot be used</h4>
              <ul className="mt-2 flex flex-col gap-1 text-body-sm">
                {preview.invalid.map((row) => (
                  <li key={row.line}>
                    <span className="text-steel-500">Line {row.line}:</span>{" "}
                    {row.email || "(no address)"} — {row.problems.map((p) => PROBLEM_TEXT[p]).join(" ")}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preview.valid.length > 0 && (
            <div className="mt-4">
              <h4 className="text-label uppercase text-steel-500">Will be imported</h4>
              <ul className="mt-2 flex flex-col gap-1 text-body-sm">
                {preview.valid.slice(0, 10).map((row) => (
                  <li key={row.line}>
                    {row.displayName} <span className="text-steel-500">{row.email}</span>
                  </li>
                ))}
                {preview.valid.length > 10 && (
                  <li className="text-steel-500">
                    and {preview.valid.length - 10} more
                  </li>
                )}
              </ul>
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-3">
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={applying || preview.valid.length === 0}
              onClick={apply}
            >
              {applying ? "Importing…" : `Import ${preview.valid.length}`}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => setPreview(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {applied && (
        <Card className="mt-4 p-5">
          <div role="status" aria-live="polite">
            <h3 className="font-display text-h5 text-ink-800">Imported</h3>
            {/* AC-055: "output reconciles counts." Every row is accounted for. */}
            <ul className="mt-3 flex flex-col gap-1 text-body-sm">
              <li>{applied.invited} invited</li>
              <li>{applied.alreadyThere} already had an account</li>
              <li>{applied.added} added to this cohort</li>
              <li>{applied.failed.length} could not be imported</li>
              <li className="text-steel-500">
                {preview?.totals.invalid ?? 0} row
                {(preview?.totals.invalid ?? 0) === 1 ? "" : "s"} were skipped before importing
              </li>
            </ul>

            {applied.failed.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1 text-body-sm">
                {applied.failed.map((failure) => (
                  <li key={failure.email}>
                    {failure.email} — {failure.reason}
                  </li>
                ))}
              </ul>
            )}

            <p className="mt-3 text-body-sm text-steel-500">
              Nobody has been assigned any learning. Use Assign a program for that.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => {
              setApplied(null);
              setPreview(null);
            }}
          >
            Done
          </Button>
        </Card>
      )}

      {preview && preview.totals.invalid > 0 && !applied && (
        <Badge variant="coral" className="mt-3">
          {preview.totals.invalid} row{preview.totals.invalid === 1 ? "" : "s"} need attention
        </Badge>
      )}
    </div>
  );
}

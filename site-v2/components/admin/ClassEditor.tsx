"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UploadAsset } from "@/components/admin/UploadAsset";
import { Alert } from "@/components/pglearn/ui/alert";
import { Badge } from "@/components/pglearn/ui/badge";
import { Button } from "@/components/pglearn/ui/button";

/*
 * One class: what it is, what it holds, and what it still needs.
 *
 * spec/04: "class format/required/body/duration; file picker; source/captions;
 * exercise instructions". The fields shown depend on the format, because a
 * text class has no duration and a video class has no body — and the database
 * enforces exactly that, so showing both would only invite a refusal.
 */

interface ClassRow {
  id: string;
  title: string;
  kind: "video" | "audio" | "text";
  required: boolean;
  position: number;
  body_md: string;
  source_text: string;
  duration_ms: number | string | null;
  primary_asset_id: string | null;
}

interface AssetRow {
  id: string;
  role: "primary" | "handout" | "caption" | "transcript";
  original_name: string;
  state: "pending" | "ready" | "failed";
  error_code: string | null;
}

export function ClassEditor({
  cls,
  exercise,
  assets,
  readOnly,
}: {
  cls: ClassRow;
  exercise: { id: string; instructions_md: string } | null;
  assets: AssetRow[];
  readOnly: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(cls.title);
  const [kind, setKind] = useState(cls.kind);
  const [required, setRequired] = useState(cls.required);
  const [body, setBody] = useState(cls.body_md);
  const [instructions, setInstructions] = useState(exercise?.instructions_md ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch(`/api/v1/classes/${cls.id}`, {
        method: "PATCH",
        // Every mutation carries one (lib/route.ts requires it), so a double
        // click or a retried request is one change rather than two.
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          title,
          kind,
          required,
          /*
           * Only what this format actually has: the schema refuses a body on a
           * media class and a duration on a text one.
           *
           * A text class's source text IS its body. spec/02 requires "every
           * class has source text from body/transcript" before publication —
           * from the body here, from the uploaded transcript for media — so
           * saving the body sets both rather than asking an author to type the
           * same words twice and leaving publication blocked when they don't.
           */
          ...(kind === "text" ? { body_md: body, source_text: body } : {}),
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "It could not be saved.");

      if (instructions.trim().length > 0) {
        const put = await fetch(`/api/v1/classes/${cls.id}/exercise`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ instructions_md: instructions }),
        });
        if (!put.ok) {
          const failure = await put.json();
          throw new Error(failure?.error?.message ?? "The exercise could not be saved.");
        }
      }

      setSaved(true);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/classes/${cls.id}`, {
        method: "DELETE",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      if (!response.ok) {
        const failure = await response.json();
        throw new Error(failure?.error?.message ?? "It could not be removed.");
      }
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const primary = assets.find((asset) => asset.role === "primary");
  const caption = assets.find((asset) => asset.role === "caption");
  const failed = assets.filter((asset) => asset.state === "failed");

  return (
    <div className="rounded-lg border border-ui-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ui-foreground">{cls.title}</span>
          <Badge variant="outline">{cls.kind}</Badge>
          {cls.required ? <Badge variant="default">Required</Badge> : null}
          {/* What publication will complain about, said before it does. */}
          {cls.kind !== "text" && !cls.primary_asset_id && (
            <Badge variant="coral">Needs media</Badge>
          )}
          {cls.kind === "video" && !caption && <Badge variant="coral">Needs captions</Badge>}
          {cls.source_text.trim().length === 0 && <Badge variant="coral">Needs source text</Badge>}
        </div>
        <Button
          type="button"
          variant="subtle"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Close" : readOnly ? "View" : "Edit"}
        </Button>
      </div>

      {open && (
        <div className="mt-4">
          <label htmlFor={`title-${cls.id}`} className="block text-xs font-medium uppercase tracking-wider text-ui-muted-foreground">
            Title
          </label>
          <input
            id={`title-${cls.id}`}
            value={title}
            disabled={readOnly}
            maxLength={160}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 w-full pglearn-field"
          />

          <div className="mt-4 flex flex-wrap gap-6">
            <div>
              <label htmlFor={`kind-${cls.id}`} className="block text-xs font-medium uppercase tracking-wider text-ui-muted-foreground">
                Format
              </label>
              <select
                id={`kind-${cls.id}`}
                value={kind}
                disabled={readOnly}
                onChange={(event) => setKind(event.target.value as ClassRow["kind"])}
                className="mt-1 pglearn-field"
              >
                <option value="video">Video</option>
                <option value="audio">Audio</option>
                <option value="text">Text</option>
              </select>
            </div>

            <label className="mt-6 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={required}
                disabled={readOnly}
                onChange={(event) => setRequired(event.target.checked)}
              />
              Required to complete the programme
            </label>
          </div>

          {kind === "text" ? (
            <>
              <label
                htmlFor={`body-${cls.id}`}
                className="mt-4 block text-xs font-medium uppercase tracking-wider text-ui-muted-foreground"
              >
                Body
              </label>
              <textarea
                id={`body-${cls.id}`}
                rows={6}
                value={body}
                disabled={readOnly}
                maxLength={100000}
                onChange={(event) => setBody(event.target.value)}
                className="mt-1 w-full pglearn-field"
              />
            </>
          ) : (
            <div className="mt-4">
              <p className="text-xs font-medium uppercase tracking-wider text-ui-muted-foreground">Media</p>
              <p className="mt-1 text-sm">
                {primary ? (
                  <>
                    {primary.original_name}{" "}
                    <Badge variant={primary.state === "ready" ? "azure" : "outline"}>
                      {primary.state}
                    </Badge>
                  </>
                ) : (
                  <span className="text-ui-muted-foreground">Nothing uploaded yet.</span>
                )}
              </p>
              {!readOnly && (
                <div className="mt-3 flex flex-wrap gap-3">
                  <UploadAsset classId={cls.id} role="primary" label="Upload media" />
                  <UploadAsset classId={cls.id} role="caption" label="Upload captions" />
                  <UploadAsset classId={cls.id} role="transcript" label="Upload transcript" />
                  <UploadAsset classId={cls.id} role="handout" label="Upload handout" />
                </div>
              )}
              {cls.duration_ms && (
                <p className="mt-2 text-sm text-ui-muted-foreground">
                  Duration {Math.round(Number(cls.duration_ms) / 1000)}s, read from the file.
                </p>
              )}
            </div>
          )}

          {failed.length > 0 && (
            /* spec/04: "source parser errors" and "failed asset with Retry" —
               the code the finalizer recorded, rather than a generic failure. */
            <Alert variant="warning" className="mt-4" role="alert">
              <p className="font-semibold">Some uploads did not finish:</p>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-5">
                {failed.map((asset) => (
                  <li key={asset.id}>
                    {asset.original_name} — {asset.error_code ?? "unknown error"}. Upload it again.
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          <label
            htmlFor={`exercise-${cls.id}`}
            className="mt-4 block text-xs font-medium uppercase tracking-wider text-ui-muted-foreground"
          >
            Practical exercise (optional)
          </label>
          <textarea
            id={`exercise-${cls.id}`}
            rows={3}
            value={instructions}
            disabled={readOnly}
            maxLength={10000}
            placeholder="What should the learner practise?"
            onChange={(event) => setInstructions(event.target.value)}
            className="mt-1 w-full pglearn-field"
          />

          {!readOnly && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button type="button" variant="primary" size="sm" disabled={busy} onClick={save}>
                {busy ? "Saving…" : "Save class"}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={remove}>
                Remove class
              </Button>
              <span role="status" aria-live="polite" className="text-sm text-ui-muted-foreground">
                {saved ? "Saved." : ""}
              </span>
            </div>
          )}

          {error && (
            <Alert variant="warning" className="mt-3" role="alert">
              {error}
            </Alert>
          )}
        </div>
      )}
    </div>
  );
}

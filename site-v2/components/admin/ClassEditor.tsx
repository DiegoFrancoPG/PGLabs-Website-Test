"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UploadAsset } from "@/components/admin/UploadAsset";
import { Alert } from "@ds/components/ui/alert";
import { Badge } from "@ds/components/ui/badge";
import { Button } from "@ds/components/ui/button";

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          kind,
          required,
          // Only what this format actually has: the schema refuses a body on a
          // media class and a duration on a text one.
          ...(kind === "text" ? { body_md: body } : {}),
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "It could not be saved.");

      if (instructions.trim().length > 0) {
        const put = await fetch(`/api/v1/classes/${cls.id}/exercise`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
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
      const response = await fetch(`/api/v1/classes/${cls.id}`, { method: "DELETE" });
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
    <div className="rounded-lg border border-steel-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body-sm text-ink-800">{cls.title}</span>
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
          <label htmlFor={`title-${cls.id}`} className="block text-label uppercase text-steel-500">
            Title
          </label>
          <input
            id={`title-${cls.id}`}
            value={title}
            disabled={readOnly}
            maxLength={160}
            onChange={(event) => setTitle(event.target.value)}
            className="mt-1 w-full rounded-lg border border-steel-300 p-2 text-body-sm disabled:bg-mist-100"
          />

          <div className="mt-4 flex flex-wrap gap-6">
            <div>
              <label htmlFor={`kind-${cls.id}`} className="block text-label uppercase text-steel-500">
                Format
              </label>
              <select
                id={`kind-${cls.id}`}
                value={kind}
                disabled={readOnly}
                onChange={(event) => setKind(event.target.value as ClassRow["kind"])}
                className="mt-1 rounded-lg border border-steel-300 p-2 text-body-sm disabled:bg-mist-100"
              >
                <option value="video">Video</option>
                <option value="audio">Audio</option>
                <option value="text">Text</option>
              </select>
            </div>

            <label className="mt-6 flex items-center gap-2 text-body-sm">
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
                className="mt-4 block text-label uppercase text-steel-500"
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
                className="mt-1 w-full rounded-lg border border-steel-300 p-2 text-body-sm disabled:bg-mist-100"
              />
            </>
          ) : (
            <div className="mt-4">
              <p className="text-label uppercase text-steel-500">Media</p>
              <p className="mt-1 text-body-sm">
                {primary ? (
                  <>
                    {primary.original_name}{" "}
                    <Badge variant={primary.state === "ready" ? "azure" : "outline"}>
                      {primary.state}
                    </Badge>
                  </>
                ) : (
                  <span className="text-steel-500">Nothing uploaded yet.</span>
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
                <p className="mt-2 text-body-sm text-steel-500">
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
            className="mt-4 block text-label uppercase text-steel-500"
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
            className="mt-1 w-full rounded-lg border border-steel-300 p-2 text-body-sm disabled:bg-mist-100"
          />

          {!readOnly && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button type="button" variant="primary" size="sm" disabled={busy} onClick={save}>
                {busy ? "Saving…" : "Save class"}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={remove}>
                Remove class
              </Button>
              <span role="status" aria-live="polite" className="text-body-sm text-steel-500">
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

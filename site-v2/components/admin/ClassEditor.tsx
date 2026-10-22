"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UploadAsset } from "@/components/admin/UploadAsset";
import { YouTubeFrame, type MediaHandle } from "@/components/learning/YouTubeFrame";
import { Alert } from "@/components/pglearn/ui/alert";
import { Badge } from "@/components/pglearn/ui/badge";
import { Button } from "@/components/pglearn/ui/button";
import { parseYouTubeVideoId, youtubeWatchUrl } from "@/lib/youtube";

/*
 * One class: what it is, what it holds, and what it still needs.
 *
 * spec/04: "class format/required/body/duration; file picker; source/captions;
 * exercise instructions". The fields shown depend on the format, because a
 * text class has no duration and a video class has no body — and the database
 * enforces exactly that, so showing both would only invite a refusal.
 *
 * A video comes from one of two sources (D-05): an uploaded file, or a YouTube
 * link. For YouTube the duration is read from the player, since there is no
 * file to read it from, and can be corrected by hand.
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
  youtube_video_id: string | null;
}

/* "9:58" or "1:02:03" to milliseconds; null for anything else. */
function parseClock(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const [h, m, sec] = parts.length === 3 ? parts.map(Number) : [0, ...parts.map(Number)];
  if (m >= 60 && parts.length === 3) return null;
  if (sec >= 60) return null;
  return ((h * 60 + m) * 60 + sec) * 1000;
}

function formatClock(ms: number): string {
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
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
  const [source, setSource] = useState<"upload" | "youtube">(cls.youtube_video_id ? "youtube" : "upload");
  const [youtubeLink, setYoutubeLink] = useState(cls.youtube_video_id ?? "");
  const [clock, setClock] = useState(cls.duration_ms ? formatClock(Number(cls.duration_ms)) : "");
  const [instructions, setInstructions] = useState(exercise?.instructions_md ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const youtubeId = parseYouTubeVideoId(youtubeLink);
  const usesYouTube = kind === "video" && source === "youtube";

  /*
   * The player knows the length once it has loaded. It fills an empty field,
   * or replaces the length of a different video; a correction the author made
   * to this same video stands.
   */
  const readDuration = (handle: MediaHandle) => {
    const seconds = handle.duration;
    if (seconds > 0 && (clock.trim() === "" || youtubeId !== cls.youtube_video_id)) {
      setClock(formatClock(seconds * 1000));
    }
  };

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      let youtubeFields = {};
      if (usesYouTube) {
        if (!youtubeId) throw new Error("Paste a YouTube link, such as https://youtu.be/…");
        const durationMs = parseClock(clock);
        if (durationMs === null || durationMs < 1000) {
          throw new Error("Enter the video's length as minutes:seconds, such as 9:58.");
        }
        youtubeFields = { youtube_video_id: youtubeId, duration_ms: durationMs };
      } else if (kind === "video" && cls.youtube_video_id) {
        // Back to an uploaded file: the YouTube link no longer applies.
        youtubeFields = { youtube_video_id: null };
      }

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
          ...youtubeFields,
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
    <div className="rounded-ui border border-ui-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ui-body text-ui-foreground">{cls.title}</span>
          <Badge variant="outline">{cls.kind}</Badge>
          {cls.required ? <Badge variant="default">Required</Badge> : null}
          {/* What publication will complain about, said before it does. */}
          {cls.youtube_video_id && <Badge variant="outline">YouTube</Badge>}
          {cls.kind !== "text" && !cls.primary_asset_id && !cls.youtube_video_id && (
            <Badge variant="coral">Needs media</Badge>
          )}
          {/* A YouTube video's captions are YouTube's own (D-05). */}
          {cls.kind === "video" && !caption && !cls.youtube_video_id && (
            <Badge variant="coral">Needs captions</Badge>
          )}
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
          <label htmlFor={`title-${cls.id}`} className="block text-ui-eyebrow uppercase text-ui-muted-foreground">
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
              <label htmlFor={`kind-${cls.id}`} className="block text-ui-eyebrow uppercase text-ui-muted-foreground">
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

            <label className="mt-6 flex items-center gap-2 text-ui-body">
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
                className="mt-4 block text-ui-eyebrow uppercase text-ui-muted-foreground"
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
              {kind === "video" && (
                <fieldset className="mb-4">
                  <legend className="text-ui-eyebrow uppercase text-ui-muted-foreground">Video source</legend>
                  <div className="mt-1 flex flex-wrap gap-6 text-ui-body">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`source-${cls.id}`}
                        checked={source === "upload"}
                        disabled={readOnly}
                        onChange={() => setSource("upload")}
                      />
                      Uploaded file
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        name={`source-${cls.id}`}
                        checked={source === "youtube"}
                        disabled={readOnly}
                        onChange={() => setSource("youtube")}
                      />
                      YouTube
                    </label>
                  </div>
                </fieldset>
              )}

              {usesYouTube ? (
                <>
                  <label
                    htmlFor={`youtube-${cls.id}`}
                    className="block text-ui-eyebrow uppercase text-ui-muted-foreground"
                  >
                    YouTube link
                  </label>
                  <input
                    id={`youtube-${cls.id}`}
                    value={youtubeLink}
                    disabled={readOnly}
                    placeholder="https://youtu.be/…"
                    aria-describedby={`youtube-help-${cls.id}`}
                    aria-invalid={youtubeLink.trim() !== "" && !youtubeId}
                    onChange={(event) => setYoutubeLink(event.target.value)}
                    className="mt-1 w-full pglearn-field"
                  />
                  <p id={`youtube-help-${cls.id}`} className="mt-1 text-ui-body text-ui-muted-foreground">
                    {youtubeLink.trim() !== "" && !youtubeId
                      ? "That is not a link to a YouTube video."
                      : "Set the video to Unlisted on YouTube and allow embedding. Anyone with the link can watch it, including people who are not enrolled."}
                  </p>

                  {youtubeId && (
                    <div className="mt-3 max-w-xl">
                      <YouTubeFrame
                        key={youtubeId}
                        videoId={youtubeId}
                        title={`Preview: ${title}`}
                        startSeconds={0}
                        onReady={readDuration}
                        onPlay={() => undefined}
                        onPause={() => undefined}
                        onTimeUpdate={() => undefined}
                        onEnded={() => undefined}
                        onRateChange={() => undefined}
                        onError={(message) => setError(message)}
                      />
                      <a
                        href={youtubeWatchUrl(youtubeId)}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 inline-block pglearn-link text-ui-body"
                      >
                        Open on YouTube
                      </a>
                    </div>
                  )}

                  <label
                    htmlFor={`duration-${cls.id}`}
                    className="mt-4 block text-ui-eyebrow uppercase text-ui-muted-foreground"
                  >
                    Length (minutes:seconds)
                  </label>
                  <input
                    id={`duration-${cls.id}`}
                    value={clock}
                    disabled={readOnly}
                    inputMode="numeric"
                    placeholder="9:58"
                    aria-describedby={`duration-help-${cls.id}`}
                    onChange={(event) => setClock(event.target.value)}
                    className="mt-1 w-32 pglearn-field"
                  />
                  <p id={`duration-help-${cls.id}`} className="mt-1 text-ui-body text-ui-muted-foreground">
                    Filled in from the player when it loads. Learners complete the class by watching 90% of it,
                    so it must match the video.
                  </p>

                  {!readOnly && (
                    <div className="mt-3 flex flex-wrap gap-3">
                      <UploadAsset classId={cls.id} role="transcript" label="Upload transcript" />
                      <UploadAsset classId={cls.id} role="handout" label="Upload handout" />
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="text-ui-eyebrow uppercase text-ui-muted-foreground">Media</p>
                  <p className="mt-1 text-ui-body">
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
                  {cls.duration_ms && !cls.youtube_video_id && (
                    <p className="mt-2 text-ui-body text-ui-muted-foreground">
                      Duration {Math.round(Number(cls.duration_ms) / 1000)}s, read from the file.
                    </p>
                  )}
                </>
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
            className="mt-4 block text-ui-eyebrow uppercase text-ui-muted-foreground"
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
              <span role="status" aria-live="polite" className="text-ui-body text-ui-muted-foreground">
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

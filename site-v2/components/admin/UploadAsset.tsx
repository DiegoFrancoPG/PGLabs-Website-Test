"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@ds/components/ui/alert";
import { Button } from "@ds/components/ui/button";

/*
 * Uploading a file, in the three steps T09 built.
 *
 *   1. authorize — the database reserves an asset row and composes the storage
 *      key from ids it holds itself, and returns a signed upload token.
 *   2. upload — the bytes go STRAIGHT to storage. They never pass through the
 *      application, which is what keeps a 500 MB video off a serverless
 *      function with a request-size limit.
 *   3. finalize — the server inspects the stored object and compares it with
 *      what was reserved, then marks the asset ready or records why not.
 *
 * Only step 2 is the browser's own work, and it is the only step that can
 * take minutes; the progress shown is the real upload's.
 */

const ACCEPT: Record<string, string> = {
  primary: "video/mp4,audio/mpeg,audio/mp4",
  caption: ".vtt,.srt,text/vtt",
  transcript: ".txt,.vtt,.srt,text/plain,text/vtt",
  handout: ".pdf,application/pdf",
};

export function UploadAsset({
  classId,
  role,
  label,
}: {
  classId: string;
  role: "primary" | "caption" | "transcript" | "handout";
  label: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    setStatus(null);
    setProgress(0);

    try {
      // 1. Authorize.
      const authorized = await fetch("/api/v1/assets/uploads", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          class_id: classId,
          role,
          original_name: file.name,
          mime_type: file.type || guessType(file.name),
          bytes: file.size,
        }),
      });
      const authorization = await authorized.json();
      if (!authorized.ok) {
        throw new Error(authorization?.error?.message ?? "This file was not accepted.");
      }

      // 2. Upload, straight to storage, with real progress.
      await putWithProgress(authorization.data.upload_url, file, setProgress);

      // 3. Finalize: the server checks the object it can see, not what we say.
      setStatus("Checking the file…");
      const finalized = await fetch(`/api/v1/assets/${authorization.data.asset.id}/finalize`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: "{}",
      });
      const result = await finalized.json();
      if (!finalized.ok) {
        throw new Error(result?.error?.message ?? "The upload could not be completed.");
      }

      setStatus(
        result.data.source_text_updated
          ? "Uploaded, and its text was indexed for the tutor."
          : "Uploaded."
      );
      setProgress(null);
      router.refresh();
    } catch (err) {
      // spec/04: "failed asset with Retry" — the control stays, so trying again
      // is one click rather than a reload.
      setError((err as Error).message);
      setProgress(null);
    }
  }

  return (
    <div>
      <input
        ref={input}
        type="file"
        accept={ACCEPT[role]}
        className="sr-only"
        id={`upload-${role}-${classId}`}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={progress !== null}
        onClick={() => input.current?.click()}
      >
        {progress !== null ? `Uploading ${progress}%` : label}
      </Button>

      <span role="status" aria-live="polite" className="ml-2 text-body-sm text-steel-500">
        {status ?? ""}
      </span>

      {error && (
        <Alert variant="warning" className="mt-2" role="alert">
          {error}
        </Alert>
      )}
    </div>
  );
}

/*
 * XMLHttpRequest rather than fetch, for one reason: it reports upload progress
 * and fetch does not. A nine-minute video on a slow connection with no
 * indication of progress is indistinguishable from a broken page.
 *
 * No Authorization header: createSignedUploadUrl returns a URL that already
 * carries its token as a query parameter, and the token is a storage grant
 * rather than a bearer credential. Sending it as one would at best be ignored.
 *
 * NOT YET EXERCISED against real storage from a browser — T09 uploaded through
 * the server with synthetic files. It is verified when the client's media
 * arrives (AC-052), and is recorded as such in HANDOFF.md.
 */
function putWithProgress(
  url: string,
  file: File,
  onProgress: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", url, true);
    request.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    // The reservation used upsert, so a retry of the same asset replaces it.
    request.setRequestHeader("x-upsert", "true");
    request.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    });
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) resolve();
      else reject(new Error(`Storage refused the upload (${request.status}).`));
    });
    request.addEventListener("error", () => reject(new Error("The upload was interrupted.")));
    request.addEventListener("abort", () => reject(new Error("The upload was cancelled.")));
    request.send(file);
  });
}

/** A browser that reports no type for a .vtt or .srt; the server checks anyway. */
function guessType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".vtt")) return "text/vtt";
  if (lower.endsWith(".srt")) return "application/x-subrip";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  return "application/octet-stream";
}

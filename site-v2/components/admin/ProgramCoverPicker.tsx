"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Check, Upload } from "lucide-react";
import { Alert } from "@/components/pglearn/ui/alert";
import { Button } from "@/components/pglearn/ui/button";
import { COVER_LIBRARY } from "@/lib/covers";
import { isUploadedCover, programCover } from "@/components/pglearn/programCover";

/*
 * Choosing a program's cover (D-19): a photograph from the design system's
 * library, an uploaded image, or the automatic choice. Large uploads are
 * scaled down in the browser first, so a phone photo fits under the upload
 * limit and learners do not download more than a card needs.
 */

const MAX_EDGE = 1920;
const UPLOAD_LIMIT = 4 * 1024 * 1024;

async function prepare(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file; // The server says what is wrong with it.
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= UPLOAD_LIMIT / 2) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  return blob ?? file;
}

export function ProgramCoverPicker({ programId, cover }: { programId: string; cover: string | null }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(next: string | null) {
    setPending(next ?? "auto");
    setError(null);
    try {
      const response = await fetch(`/api/v1/programs/${programId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ cover_image: next }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error?.message ?? "The cover could not be saved.");
      // A database without M37 ignores the field rather than refusing it.
      if ((json?.data?.cover_image ?? null) !== next) {
        throw new Error("The cover was not saved. The database update M37 may not be applied yet.");
      }
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
    }
  }

  async function upload(file: File) {
    setPending("upload");
    setError(null);
    try {
      const body = new FormData();
      body.append("file", await prepare(file), file.name);
      const response = await fetch(`/api/v1/programs/${programId}/cover`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body,
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error?.message ?? "The image could not be uploaded.");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(null);
      if (input.current) input.current.value = "";
    }
  }

  const current = programCover(programId, cover);

  return (
    <div>
      <div className="relative aspect-[16/9] w-full max-w-md overflow-hidden rounded-ui border border-ui-border bg-ui-muted">
        <Image
          src={current}
          alt="Current cover"
          fill
          sizes="448px"
          unoptimized={isUploadedCover(cover)}
          className="object-cover"
        />
      </div>
      <p className="mt-2 text-ui-body text-ui-muted-foreground">
        {cover === null
          ? "Chosen automatically. Pick a photograph or upload your own."
          : isUploadedCover(cover)
            ? "An uploaded image."
            : "A photograph from the design system."}
      </p>

      <div className="mt-3 flex flex-wrap gap-3">
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen((value) => !value)}>
          {open ? "Close the library" : "Choose from the library"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending !== null}
          onClick={() => input.current?.click()}
        >
          <Upload aria-hidden />
          {pending === "upload" ? "Uploading…" : "Upload an image"}
        </Button>
        {cover !== null && (
          <Button type="button" variant="ghost" size="sm" disabled={pending !== null} onClick={() => choose(null)}>
            Use the automatic choice
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          aria-label="Cover image file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>
      <p className="mt-2 text-ui-body text-ui-muted-foreground">JPEG, PNG or WebP. Wide images (16:9) fit best.</p>

      {error && (
        <Alert variant="warning" className="mt-3" role="alert">
          {error}
        </Alert>
      )}

      {open && (
        <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {COVER_LIBRARY.map((photo) => {
            const selected = photo.src === cover;
            return (
              <li key={photo.src}>
                <button
                  type="button"
                  disabled={pending !== null}
                  onClick={() => choose(photo.src)}
                  aria-pressed={selected}
                  aria-label={`${photo.group} photograph${selected ? ", current cover" : ""}`}
                  className={`relative block aspect-[16/9] w-full overflow-hidden rounded-ui border-2 bg-ui-muted ${
                    selected ? "border-ui-brand" : "border-transparent hover:border-ui-input"
                  }`}
                >
                  <Image src={photo.src} alt="" fill sizes="240px" className="object-cover" />
                  {selected && (
                    <span className="absolute right-1.5 top-1.5 rounded-full bg-ui-brand p-1 text-white">
                      <Check className="size-3" aria-hidden />
                    </span>
                  )}
                  {pending === photo.src && (
                    <span className="absolute inset-0 grid place-items-center bg-black/40 text-ui-body text-white">
                      Saving…
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

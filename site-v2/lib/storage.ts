import { serviceClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";

/*
 * StorageProvider, the internal contract from spec/05. Callers never depend on
 * vendor response shapes, so the Supabase implementation can be replaced
 * without touching a feature module.
 *
 * spec/02: "Server issues short-lived signed uploads for authorized admin asset
 * IDs and signed downloads for exact authorized class assets ... Service
 * credentials authorize signing, so these route checks are security-critical."
 * Nothing in this file authorizes anything — it assumes the caller already has.
 */

export interface AssetRef {
  id: string;
  classId: string;
  versionId: string;
  originalName: string;
}

export interface UploadAuthorization {
  uploadUrl: string;
  uploadToken: string;
  storagePath: string;
  expiresAt: string;
  resumable: boolean;
}

export interface ObjectFacts {
  exists: boolean;
  bytes: number;
  mimeType: string;
}

/* spec/03's supported set. MIME and extension must agree. */
export const SUPPORTED_UPLOADS = {
  "video/mp4": { extensions: ["mp4"], maxBytes: 1_073_741_824, roles: ["primary"] },
  "audio/mpeg": { extensions: ["mp3"], maxBytes: 1_073_741_824, roles: ["primary"] },
  "audio/mp4": { extensions: ["m4a", "mp4"], maxBytes: 1_073_741_824, roles: ["primary"] },
  "application/pdf": { extensions: ["pdf"], maxBytes: 26_214_400, roles: ["handout"] },
  "text/plain": { extensions: ["txt"], maxBytes: 2_097_152, roles: ["transcript"] },
  "text/vtt": { extensions: ["vtt"], maxBytes: 2_097_152, roles: ["caption"] },
  "application/x-subrip": { extensions: ["srt"], maxBytes: 2_097_152, roles: ["caption"] },
} as const;

export type SupportedMime = keyof typeof SUPPORTED_UPLOADS;

export class StorageError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "StorageError";
  }
}

/**
 * Reduces a filename to something that cannot escape its own directory.
 *
 * spec/02: "Object names: versions/{version_id}/classes/{class_id}/{asset_id}/
 * {sanitized_filename}; no user input path traversal."
 *
 * Only the basename survives, and it is then restricted to a safe character
 * set — so a name like "../../etc/passwd" or one carrying a NUL or a newline
 * cannot alter the path it lands in.
 */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const cleaned = Array.from(base.normalize("NFC"))
    /*
     * An allowlist, not a blocklist. Anything outside this set — control
     * characters, NUL, newlines, quotes, percent signs — becomes an
     * underscore, so no character survives that could alter the path.
     */
    .map((character) => (/[A-Za-z0-9._-]/.test(character) ? character : "_"))
    .join("")
    /*
     * Runs of dots collapse to one. Without a separator ".." cannot traverse
     * anything, but leaving it in a key means relying on every tool downstream
     * agreeing — and a single dot keeps ordinary extensions intact anyway.
     */
    .replace(/\.{2,}/g, ".")
    // A leading dot would make the object hidden.
    .replace(/^\.+/, "")
    .slice(0, 120);
  return cleaned === "" ? "file" : cleaned;
}

export function extensionOf(name: string): string {
  const base = sanitizeFilename(name);
  const dot = base.lastIndexOf(".");
  return dot === -1 ? "" : base.slice(dot + 1).toLowerCase();
}

/**
 * Validates a declared upload against spec/03's supported set: the MIME type,
 * the extension agreeing with it, the role it is allowed to serve, and the size
 * limit for that kind of file.
 */
export function validateUpload(input: {
  role: string;
  originalName: string;
  mimeType: string;
  bytes: number;
}): void {
  const rule = SUPPORTED_UPLOADS[input.mimeType as SupportedMime];
  if (!rule) {
    throw new StorageError("UPLOAD_TYPE_UNSUPPORTED", "That file type is not supported.");
  }
  if (!(rule.roles as readonly string[]).includes(input.role)) {
    throw new StorageError(
      "UPLOAD_ROLE_MISMATCH",
      `A ${input.role} cannot be a ${input.mimeType} file.`
    );
  }
  const extension = extensionOf(input.originalName);
  if (!(rule.extensions as readonly string[]).includes(extension)) {
    // spec/03: "MIME and extension must agree with supported set."
    throw new StorageError(
      "UPLOAD_EXTENSION_MISMATCH",
      "The file extension does not match its type."
    );
  }
  if (input.bytes < 1 || input.bytes > rule.maxBytes) {
    throw new StorageError("UPLOAD_TOO_LARGE", "That file is larger than the limit for its type.");
  }
}

export function storagePathFor(asset: AssetRef): string {
  return `versions/${asset.versionId}/classes/${asset.classId}/${asset.id}/${sanitizeFilename(
    asset.originalName
  )}`;
}

/**
 * Caption objects are stored beside their original as normalized WebVTT.
 *
 * Derived from the stored key rather than recomposed from ids: the key is
 * already the authoritative path the database issued, so this cannot drift
 * from it or be built out of values a caller supplied.
 */
export function playbackPathFromStorageKey(storageKey: string): string {
  const slash = storageKey.lastIndexOf("/");
  if (slash === -1) {
    throw new StorageError("STORAGE_KEY_INVALID", "The stored key is not a path.");
  }
  return `${storageKey.slice(0, slash)}/normalized.vtt`;
}

const DOWNLOAD_TTL_SECONDS = 900; // spec/03
const UPLOAD_TTL_SECONDS = 3600;

function bucket() {
  return serviceClient().storage.from(serverEnv().SUPABASE_STORAGE_BUCKET);
}

export async function authorizeUpload(asset: AssetRef): Promise<UploadAuthorization> {
  const path = storagePathFor(asset);
  const { data, error } = await bucket().createSignedUploadUrl(path, { upsert: true });
  if (error || !data) {
    throw new StorageError("STORAGE_UNAVAILABLE", "Upload could not be authorized.");
  }
  return {
    uploadUrl: data.signedUrl,
    uploadToken: data.token,
    storagePath: path,
    expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000).toISOString(),
    resumable: false,
  };
}

/** What the object ACTUALLY is, which is what finalization must trust. */
export async function inspect(path: string): Promise<ObjectFacts> {
  const slash = path.lastIndexOf("/");
  const { data, error } = await bucket().list(path.slice(0, slash), {
    search: path.slice(slash + 1),
    limit: 1,
  });
  if (error || !data || data.length === 0) return { exists: false, bytes: 0, mimeType: "" };
  const found = data[0];
  return {
    exists: true,
    bytes: Number(found.metadata?.size ?? 0),
    mimeType: String(found.metadata?.mimetype ?? ""),
  };
}

export async function readText(path: string, maxBytes: number): Promise<string> {
  const { data, error } = await bucket().download(path);
  if (error || !data) {
    throw new StorageError("STORAGE_OBJECT_MISSING", "The uploaded file could not be read.");
  }
  const buffer = await data.arrayBuffer();
  if (buffer.byteLength > maxBytes) {
    throw new StorageError("UPLOAD_TOO_LARGE", "That file is larger than the limit for its type.");
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buffer);
}

export async function writeDerivedCaption(
  storageKey: string,
  vtt: string
): Promise<{ playbackKey: string }> {
  const path = playbackPathFromStorageKey(storageKey);
  const { error } = await bucket().upload(path, new Blob([vtt], { type: "text/vtt" }), {
    upsert: true,
    contentType: "text/vtt",
  });
  if (error) {
    throw new StorageError("STORAGE_UNAVAILABLE", "The caption could not be stored.");
  }
  return { playbackKey: path };
}

export async function signDownload(
  path: string,
  ttlSeconds: number = DOWNLOAD_TTL_SECONDS
): Promise<{ url: string; expiresAt: string }> {
  const { data, error } = await bucket().createSignedUrl(path, ttlSeconds);
  if (error || !data) {
    throw new StorageError("STORAGE_UNAVAILABLE", "The file link could not be created.");
  }
  return {
    url: data.signedUrl,
    expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
  };
}

export async function removeObject(path: string): Promise<void> {
  await bucket().remove([path]);
}

/**
 * Copying one object to another key, for version cloning (T27).
 *
 * An asset's storage_key is UNIQUE, so a cloned class cannot point at the
 * source's object — AC-056 requires the new version to own its media outright,
 * or deleting a draft would take a published version's files with it. The copy
 * happens server-side in storage rather than by downloading and re-uploading:
 * these are video files.
 *
 * Returns false rather than throwing when the source is not there, because a
 * clone of forty classes must report which files need re-uploading rather than
 * abandon the whole draft over one of them.
 */
export async function copyObject(from: string, to: string): Promise<boolean> {
  if (from === to) return false;
  const { error } = await bucket().copy(from, to);
  if (!error) return true;
  // Already copied — a retried clone is not a failure.
  const status = (error as { statusCode?: string | number }).statusCode;
  return String(status) === "409";
}

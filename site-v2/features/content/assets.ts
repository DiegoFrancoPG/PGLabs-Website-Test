import { z } from "zod";
import { callRpc, RpcError } from "@/lib/rpc";
import { convertToVtt, CaptionError } from "@/lib/captions";
import {
  authorizeUpload as signUpload,
  inspect,
  readText,
  writeDerivedCaption,
  signDownload,
  validateUpload,
  sanitizeFilename,
  SUPPORTED_UPLOADS,
  StorageError,
  type SupportedMime,
} from "@/lib/storage";

/*
 * Asset lifecycle: authorize, upload (by the browser, straight to storage),
 * finalize, and later authorize a download.
 *
 * spec/03: "Complete upload then finalize; ready status only after validation."
 * Nothing becomes usable because it was uploaded — only because finalization
 * checked what actually arrived.
 */

export const uploadCreateSchema = z
  .object({
    class_id: z.string().uuid(),
    role: z.enum(["primary", "handout", "caption", "transcript"]),
    original_name: z.string().min(1).max(255),
    mime_type: z.enum(
      Object.keys(SUPPORTED_UPLOADS) as [SupportedMime, ...SupportedMime[]]
    ),
    bytes: z.number().int().min(1).max(1_073_741_824),
  })
  .strict();

export const downloadRequestSchema = z
  .object({
    enrollment_id: z.string().uuid().nullable(),
    preview: z.boolean(),
  })
  .strict();

export const finalizeSchema = z
  .object({ duration_ms: z.number().int().min(1000).max(14_400_000).nullable().optional() })
  .strict();

/* The Asset shape from contracts/api.json, used for typing responses. */
const assetSchema = z.object({
  id: z.string().uuid(),
  class_id: z.string().uuid(),
  role: z.enum(["primary", "handout", "caption", "transcript"]),
  original_name: z.string(),
  mime_type: z.string(),
  bytes: z.union([z.number(), z.string()]),
  state: z.enum(["pending", "ready", "failed"]),
  error_code: z.string().nullable(),
});

export type Asset = z.infer<typeof assetSchema>;
export { assetSchema };

export async function authorizeUpload(
  input: z.infer<typeof uploadCreateSchema>,
  requestId: string
) {
  /*
   * Checked before anything is reserved, so an unsupported or oversized file
   * never creates a row. The filename is sanitized here too — the storage path
   * is composed from it, and spec/02 forbids user input reaching the path.
   */
  validateUpload({
    role: input.role,
    originalName: input.original_name,
    mimeType: input.mime_type,
    bytes: input.bytes,
  });

  /*
   * The filename is sanitized before it leaves here, and the database composes
   * the path from it plus ids it holds itself — so the stored key is the one
   * source of truth and there is no second write to record it.
   */
  const reserved = (await callRpc("authorize_upload", {
    request_id: requestId,
    class_id: input.class_id,
    role: input.role,
    original_name: sanitizeFilename(input.original_name),
    mime_type: input.mime_type,
    bytes: input.bytes,
  })) as { asset: Asset; version_id: string; class_id: string; storage_key: string };

  const authorization = await signUpload({
    id: reserved.asset.id,
    classId: reserved.class_id,
    versionId: reserved.version_id,
    originalName: input.original_name,
  });

  return {
    asset: reserved.asset,
    upload_url: authorization.uploadUrl,
    upload_token: authorization.uploadToken,
    storage_path: reserved.storage_key,
    expires_at: authorization.expiresAt,
    resumable: authorization.resumable,
  };
}

export interface FinalizeResult {
  asset: Asset;
  source_text_updated: boolean;
}

/**
 * spec/03: "Admin upload finalization checks actual object size/type,
 * class/draft identity and source parsing before setting ready."
 *
 * Each failure records a stable error code on the asset rather than throwing it
 * away, so the editor can say exactly what is wrong and publication stays
 * blocked until it is fixed (AC-016).
 */
export async function finalizeUpload(
  assetId: string,
  declared: {
    role: string;
    mimeType: string;
    declaredBytes: number;
    storagePath: string;
    durationMs?: number | null;
  },
  input: z.infer<typeof finalizeSchema> = {}
): Promise<FinalizeResult> {
  const fail = async (code: string) =>
    (await callRpc("finalize_upload", {
      asset_id: assetId,
      ok: false,
      error_code: code,
    })) as FinalizeResult;

  const facts = await inspect(declared.storagePath);
  if (!facts.exists) return fail("UPLOAD_OBJECT_MISSING");

  // The stored object is the truth; the declared values were only a promise.
  if (facts.bytes !== declared.declaredBytes) return fail("UPLOAD_SIZE_MISMATCH");

  const rule = SUPPORTED_UPLOADS[declared.mimeType as SupportedMime];
  if (rule && facts.bytes > rule.maxBytes) return fail("UPLOAD_TOO_LARGE");

  /*
   * Storage reports what the browser declared, so a matching type is necessary
   * but not sufficient. For the formats we can parse, the parse below is the
   * real check.
   */
  if (facts.mimeType && facts.mimeType !== declared.mimeType) {
    return fail("UPLOAD_TYPE_MISMATCH");
  }

  let playbackKey: string | undefined;
  let sourceText: string | undefined;

  if (declared.role === "caption") {
    let raw: string;
    try {
      raw = await readText(declared.storagePath, rule?.maxBytes ?? 2_097_152);
    } catch {
      return fail("UPLOAD_OBJECT_UNREADABLE");
    }
    try {
      const converted = convertToVtt(raw, {
        durationMs: input.duration_ms ?? declared.durationMs ?? null,
      });
      // Written beside the original, at a path derived from the stored key.
      const stored = await writeDerivedCaption(declared.storagePath, converted.vtt);
      playbackKey = stored.playbackKey;
      sourceText = converted.sourceText;
    } catch (err) {
      if (err instanceof CaptionError) return fail(err.code);
      if (err instanceof StorageError) return fail(err.code);
      throw err;
    }
  }

  if (declared.role === "transcript") {
    try {
      const text = await readText(declared.storagePath, rule?.maxBytes ?? 2_097_152);
      sourceText = text.replace(/\s+/g, " ").trim();
      if (sourceText === "") return fail("TRANSCRIPT_EMPTY");
    } catch {
      return fail("UPLOAD_OBJECT_UNREADABLE");
    }
  }

  return (await callRpc("finalize_upload", {
    asset_id: assetId,
    ok: true,
    actual_bytes: facts.bytes,
    playback_key: playbackKey ?? "",
    source_text: sourceText ?? "",
    duration_ms: input.duration_ms ?? declared.durationMs ?? null,
  })) as FinalizeResult;
}

/**
 * AC-062. Authorization is re-evaluated on every call and the URL is minted
 * fresh afterwards — a replay can never hand back a usable link from a
 * permission that has since been revoked.
 */
export async function authorizeDownload(
  assetId: string,
  request: z.infer<typeof downloadRequestSchema>
) {
  const authorized = (await callRpc("authorize_download", {
    asset_id: assetId,
    enrollment_id: request.enrollment_id,
    preview: request.preview,
  })) as { storage_path: string };

  // Signed only after the database said yes, never before.
  const signed = await signDownload(authorized.storage_path);
  return { url: signed.url, expires_at: signed.expiresAt };
}

export { RpcError };

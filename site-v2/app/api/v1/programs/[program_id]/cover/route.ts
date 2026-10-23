import { NextResponse } from "next/server";
import { verifiedUser } from "@/lib/auth";
import { getMe } from "@/features/identity/me";
import { updateProgram } from "@/features/content/content";
import { jsonError, jsonOk, resolveRequestId, isUuid } from "@/lib/http";
import { RpcError } from "@/lib/rpc";
import { programCoverKey, removeObject, signDownload, uploadProgramCover } from "@/lib/storage";

/*
 * operationIds get_program_cover and upload_program_cover (M37, D-19).
 *
 * A program's uploaded cover lives in the private bucket. Covers are not
 * secret, but the bucket is (spec/02), so GET signs a short-lived URL for any
 * signed-in user and redirects to it. POST takes the image as multipart
 * form data from an administrator, stores it at the program's fixed key and
 * records a new token on the program.
 */
export const dynamic = "force-dynamic";

// Under the hosting platform's 4.5 MB request limit.
const MAX_BYTES = 4 * 1024 * 1024;

/* What the bytes are, not what the browser says: JPEG, PNG or WebP. */
function sniff(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function GET(request: Request, { params }: { params: Promise<{ program_id: string }> }) {
  const { program_id } = await params;
  const requestId = resolveRequestId(request);
  if (!(await verifiedUser())) return jsonError("UNAUTHENTICATED", "Sign in to continue.", requestId);
  if (!isUuid(program_id)) return jsonError("NOT_FOUND", "Not found.", requestId);
  try {
    const { url } = await signDownload(programCoverKey(program_id), 3600);
    // The ?v= token in the page's URL changes with each upload, so the
    // redirect can be cached for a while by this browser alone.
    return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "private, max-age=1800" } });
  } catch {
    return jsonError("NOT_FOUND", "Not found.", requestId);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ program_id: string }> }) {
  const { program_id } = await params;
  const requestId = resolveRequestId(request);

  const key = request.headers.get("Idempotency-Key");
  if (!key || !isUuid(key)) {
    return jsonError("VALIDATION_ERROR", "A UUID Idempotency-Key header is required.", requestId, [
      { path: "Idempotency-Key", message: "must be a UUID" },
    ]);
  }
  if (!(await verifiedUser())) return jsonError("UNAUTHENTICATED", "Sign in to continue.", requestId);
  // Checked before anything is stored; update_program checks it again.
  if (!(await getMe()).platform_admin) return jsonError("FORBIDDEN", "Not permitted.", requestId);
  if (!isUuid(program_id)) return jsonError("NOT_FOUND", "Not found.", requestId);

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("file");
  } catch {
    return jsonError("VALIDATION_ERROR", "Send the image as form data.", requestId);
  }
  if (!(file instanceof Blob) || file.size === 0) {
    return jsonError("VALIDATION_ERROR", "Choose an image to upload.", requestId, [
      { path: "file", message: "required" },
    ]);
  }
  if (file.size > MAX_BYTES) {
    return jsonError("VALIDATION_ERROR", "The image must be 4 MB or smaller.", requestId, [
      { path: "file", message: "larger than 4 MB" },
    ]);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = sniff(bytes);
  if (!type) {
    return jsonError("VALIDATION_ERROR", "Use a JPEG, PNG or WebP image.", requestId, [
      { path: "file", message: "not a JPEG, PNG or WebP image" },
    ]);
  }

  try {
    await uploadProgramCover(program_id, new Blob([bytes], { type }), type);
  } catch {
    return jsonError("PROVIDER_UNAVAILABLE", "The image could not be stored. Try again.", requestId);
  }
  try {
    const token = `upload:${crypto.randomUUID()}`;
    const program = await updateProgram(program_id, { cover_image: token });
    // A database without M37 ignores the field rather than refusing it.
    if (program.cover_image !== token) {
      return jsonError("NOT_CONFIGURED", "Covers need the database update M37.", requestId);
    }
    return jsonOk(program, requestId);
  } catch (err) {
    if (err instanceof RpcError) {
      if (err.code === "NOT_FOUND") await removeObject(programCoverKey(program_id)).catch(() => undefined);
      return jsonError(err.code, err.message, requestId, err.fields);
    }
    console.error("[api] unexpected", err);
    return jsonError("CONFLICT", "The request could not be completed.", requestId);
  }
}

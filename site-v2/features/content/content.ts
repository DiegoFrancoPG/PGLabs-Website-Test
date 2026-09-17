import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { copyObject, playbackPathFromStorageKey } from "@/lib/storage";
import { serviceClient } from "@/lib/supabase/server";
import { verifiedUser } from "@/lib/auth";

/* Mirrors the content schemas in contracts/api.json. */
export const programSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(160),
  summary: z.string().max(2000),
  archived: z.boolean(),
  latest_published_version_id: z.string().uuid().nullable(),
});

export const versionSchema = z.object({
  id: z.string().uuid(),
  program_id: z.string().uuid(),
  version_number: z.number().int().min(1),
  title: z.string().min(1).max(160),
  description_md: z.string().max(20000),
  state: z.enum(["draft", "published"]),
  published_at: z.string().nullable(),
});

export const moduleSchema = z.object({
  id: z.string().uuid(),
  version_id: z.string().uuid(),
  title: z.string().min(1).max(160),
  position: z.number().int().min(0),
});

export const classSchema = z.object({
  id: z.string().uuid(),
  module_id: z.string().uuid(),
  version_id: z.string().uuid(),
  title: z.string().min(1).max(160),
  kind: z.enum(["video", "audio", "text"]),
  required: z.boolean(),
  position: z.number().int().min(0),
  body_md: z.string().max(100000),
  source_text: z.string().max(200000),
  duration_ms: z.union([z.number(), z.string()]).nullable(),
  primary_asset_id: z.string().uuid().nullable(),
});

export const programCreateSchema = z
  .object({ title: z.string().trim().min(1).max(160), summary: z.string().max(2000) })
  .strict();

export const programPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    summary: z.string().max(2000).optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

export const versionPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    description_md: z.string().max(20000).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

export const moduleCreateSchema = z
  .object({ title: z.string().trim().min(1).max(160), position: z.number().int().min(0).optional() })
  .strict();

export const modulePatchSchema = z
  .object({ title: z.string().trim().min(1).max(160) })
  .strict();

const durationMs = z.number().int().min(1000).max(14400000);

export const classCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    kind: z.enum(["video", "audio", "text"]).optional(),
    required: z.boolean().optional(),
    position: z.number().int().min(0).optional(),
    body_md: z.string().max(100000).optional(),
    source_text: z.string().max(200000).optional(),
    duration_ms: durationMs.nullable().optional(),
  })
  .strict();

export const classPatchSchema = classCreateSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

export const exercisePutSchema = z
  .object({ instructions_md: z.string().trim().min(1).max(10000) })
  .strict();

/*
 * spec/03: the reorder takes "the exact complete sibling ID list without
 * duplicates". uniqueItems is enforced here as well as in the handler, so an
 * obviously malformed list never reaches the database.
 */
export const reorderSchema = z
  .object({
    parent_kind: z.enum(["version", "module"]),
    parent_id: z.string().uuid(),
    ordered_ids: z
      .array(z.string().uuid())
      .min(1)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, { message: "ordered_ids must be unique" }),
  })
  .strict();

export async function listPrograms() {
  return z
    .object({ items: z.array(programSchema), next_cursor: z.string().nullable() })
    .parse(await callRpc("list_programs", {}));
}

export async function createProgram(input: z.infer<typeof programCreateSchema>, requestId: string) {
  return z
    .object({ program: programSchema, version: versionSchema })
    .parse(await callRpc("create_program", { request_id: requestId, ...input }));
}

export async function updateProgram(
  programId: string,
  patch: z.infer<typeof programPatchSchema>
) {
  return programSchema.parse(await callRpc("update_program", { program_id: programId, ...patch }));
}

/* contracts/api.json's Exercise, for the version editor. */
export const exerciseSchema = z.object({
  id: z.string().uuid(),
  class_id: z.string().uuid(),
  instructions_md: z.string().min(1).max(10000),
});

/*
 * VersionDetail: the whole draft in one read, which is what the editor needs —
 * a screen that fetched modules, then classes, then exercises would show a
 * half-built outline while it waited.
 */
export const versionDetailSchema = z.object({
  version: versionSchema,
  modules: z.array(moduleSchema),
  classes: z.array(classSchema),
  exercises: z.array(exerciseSchema),
  assets: z.array(
    z.object({
      id: z.string().uuid(),
      class_id: z.string().uuid(),
      role: z.enum(["primary", "handout", "caption", "transcript"]),
      original_name: z.string(),
      mime_type: z.string(),
      bytes: z.union([z.number(), z.string()]),
      state: z.enum(["pending", "ready", "failed"]),
      error_code: z.string().nullable(),
    })
  ),
});

export type VersionDetail = z.infer<typeof versionDetailSchema>;
export type Program = z.infer<typeof programSchema>;
export type ClassRow = z.infer<typeof classSchema>;
export type ModuleRow = z.infer<typeof moduleSchema>;

/**
 * The program's draft, created on first use.
 *
 * contracts/api.json calls this clone_version. It returns an EXISTING draft
 * rather than making a second one, which is what makes it the way back to work
 * in progress: `Program` carries only `latest_published_version_id`, and no
 * operation lists a program's versions, so without this an author who
 * navigated away could not find their draft again.
 */
const copySchema = z.object({
  asset_id: z.string().uuid(),
  from: z.string(),
  to: z.string(),
  role: z.enum(["primary", "handout", "caption", "transcript"]),
  from_playback: z.string().nullable(),
  duration_ms: z.union([z.number(), z.string()]).nullable(),
});

export interface DraftVersionResult {
  version: z.infer<typeof versionSchema>;
  created: boolean;
  /** How the media came across, so the author is told rather than surprised. */
  assets: { copied: number; failed: number };
}

export async function draftVersion(
  programId: string,
  requestId: string
): Promise<DraftVersionResult> {
  const result = z
    .object({
      version: versionSchema,
      created: z.boolean(),
      copies: z.array(copySchema).default([]),
    })
    .parse(await callRpc("clone_version", { request_id: requestId, program_id: programId }));

  /*
   * The second half of the clone, outside the transaction.
   *
   * AC-056 — "Existing learners keep original IDs/requirements/media" — is why
   * this copies rather than shares: the draft's asset rows are new rows at new
   * keys, so nothing an author does to them can reach the published version
   * the current learners are enrolled against.
   *
   * Storage is a different system and cannot join the database transaction, so
   * the rows were written PENDING and each one is settled here. A file that
   * does not copy leaves its asset failed, which is exactly what blocks
   * publication until somebody uploads it again — a half-cloned version cannot
   * quietly go live.
   */
  const assets = { copied: 0, failed: 0 };
  // Established once: verifiedUser() revalidates with the Auth server, and a
  // version with forty files does not need forty round trips to learn the same
  // answer.
  const actor = result.copies.length > 0 ? await actorId() : "";
  for (const copy of result.copies) {
    let ok = false;
    let playbackKey: string | null = null;
    try {
      ok = await copyObject(copy.from, copy.to);
      if (ok && copy.from_playback) {
        // The derived .vtt the player reads travels with its caption.
        const derived = playbackPathFromStorageKey(copy.to);
        playbackKey = (await copyObject(copy.from_playback, derived)) ? derived : null;
      }
    } catch {
      ok = false;
    }

    await cloneJob({
      actor,
      asset_id: copy.asset_id,
      ok,
      error_code: ok ? null : "SOURCE_MISSING",
      playback_key: playbackKey,
      duration_ms: copy.duration_ms === null ? null : Number(copy.duration_ms),
    });
    if (ok) assets.copied += 1;
    else assets.failed += 1;
  }

  return { version: result.version, created: result.created, assets };
}

async function actorId(): Promise<string> {
  const user = await verifiedUser();
  if (!user) throw new Error("clone_version requires a signed-in administrator");
  return user.id;
}

/*
 * clone.finish runs through the service-role job dispatcher rather than
 * pglearn_rpc: it is an internal step of clone_version, the way finalize is an
 * internal step of an upload, and the user-facing allowlist must keep matching
 * contracts/api.json operation for operation. The handler re-checks that the
 * actor is a platform administrator, because service_role cannot read auth.uid().
 */
async function cloneJob(payload: Record<string, unknown>): Promise<void> {
  const supabase = serviceClient();
  const { error } = await supabase.rpc("pglearn_job", { job: "clone.finish", payload });
  if (error) throw new Error(`clone.finish failed: ${error.code ?? ""}`);
}

export async function getVersion(versionId: string): Promise<VersionDetail> {
  return versionDetailSchema.parse(await callRpc("get_version", { version_id: versionId }));
}

/**
 * Publishing. The handler returns its refusal as DATA — a list of issues —
 * rather than as an error, because the draft is intact and the author needs
 * every problem at once rather than the first one.
 */
export interface PublishResult {
  version: { id: string; state: string; published_at: string | null };
  issues: { path: string; message: string }[];
}

export async function publishVersion(versionId: string): Promise<PublishResult> {
  return callRpc<PublishResult>("publish_version", { version_id: versionId });
}

export const updateVersion = (versionId: string, patch: z.infer<typeof versionPatchSchema>) =>
  callRpc("update_version", { version_id: versionId, ...patch });

export const createModule = (versionId: string, input: z.infer<typeof moduleCreateSchema>, requestId: string) =>
  callRpc("create_module", { request_id: requestId, version_id: versionId, ...input });

export const updateModule = (moduleId: string, patch: z.infer<typeof modulePatchSchema>) =>
  callRpc("update_module", { module_id: moduleId, ...patch });

export const createClass = (moduleId: string, input: z.infer<typeof classCreateSchema>, requestId: string) =>
  callRpc("create_class", { request_id: requestId, module_id: moduleId, ...input });

export const updateClass = (classId: string, patch: z.infer<typeof classPatchSchema>) =>
  callRpc("update_class", { class_id: classId, ...patch });

export const deleteClass = (classId: string) => callRpc("delete_class", { class_id: classId });

export const putExercise = (classId: string, input: z.infer<typeof exercisePutSchema>) =>
  callRpc("put_exercise", { class_id: classId, ...input });

export const deleteExercise = (classId: string) => callRpc("delete_exercise", { class_id: classId });

export const reorderContent = (input: z.infer<typeof reorderSchema>) =>
  callRpc("reorder_content", input);

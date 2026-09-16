import { z } from "zod";
import { callRpc } from "@/lib/rpc";

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

export async function getVersion(versionId: string) {
  return callRpc("get_version", { version_id: versionId });
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

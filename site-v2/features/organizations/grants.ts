import { z } from "zod";
import { callRpc } from "@/lib/rpc";

/* Mirrors contracts/api.json's Grant, GrantCreate and GrantPatch. */
export const grantSchema = z.object({
  id: z.string().uuid(),
  program_id: z.string().uuid(),
  organization_id: z.string().uuid().nullable(),
  user_id: z.string().uuid().nullable(),
  starts_at: z.string(),
  ends_at: z.string().nullable(),
  status: z.enum(["active", "revoked"]),
  source: z.enum(["manual", "billing"]),
});

/*
 * The contract's oneOf: exactly one of organization_id and user_id is non-null.
 * Expressed as a refinement so the API rejects both-or-neither before the
 * database has to, though the database checks it independently as well.
 */
export const grantCreateSchema = z
  .object({
    program_id: z.string().uuid(),
    organization_id: z.string().uuid().nullable(),
    user_id: z.string().uuid().nullable(),
    starts_at: z.string().datetime(),
    ends_at: z.string().datetime().nullable(),
  })
  .strict()
  .refine((v) => (v.organization_id === null) !== (v.user_id === null), {
    message: "exactly one of organization_id or user_id must be set",
  });

/* Dates and status only: the subject is immutable after creation. */
export const grantPatchSchema = z
  .object({
    starts_at: z.string().datetime().optional(),
    ends_at: z.string().datetime().nullable().optional(),
    status: z.enum(["active", "revoked"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

export async function listGrants(organizationId?: string) {
  return z
    .object({ items: z.array(grantSchema), next_cursor: z.string().nullable() })
    .parse(await callRpc("list_grants", organizationId ? { organization_id: organizationId } : {}));
}

export async function createGrant(input: z.infer<typeof grantCreateSchema>, requestId: string) {
  return grantSchema.parse(await callRpc("create_grant", { request_id: requestId, ...input }));
}

export async function updateGrant(grantId: string, patch: z.infer<typeof grantPatchSchema>) {
  return grantSchema.parse(await callRpc("update_grant", { grant_id: grantId, ...patch }));
}

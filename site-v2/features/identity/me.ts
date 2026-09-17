import { z } from "zod";
import { callRpc } from "@/lib/rpc";

/*
 * Identity feature service. Mirrors contracts/api.json's Me, Profile, Context
 * and ProfilePatch, which spec/01 makes authoritative for these shapes.
 */

export const profileSchema = z.object({
  id: z.string().uuid(),
  email: z.string(),
  display_name: z.string().min(1).max(120),
  timezone: z.string(),
  reminders_enabled: z.boolean(),
  onboarded_at: z.string().nullable(),
});

export const contextSchema = z.object({
  organization_id: z.string().uuid(),
  organization_name: z.string().min(1).max(120),
  role: z.enum(["manager", "learner"]),
  status: z.enum(["invited", "active", "removed"]),
});

export const meSchema = z.object({
  profile: profileSchema,
  platform_admin: z.boolean(),
  contexts: z.array(contextSchema),
});

export type Me = z.infer<typeof meSchema>;

/*
 * ProfilePatch, exactly: three optional fields, at least one present, and
 * nothing else permitted. `.strict()` is what rejects an attempt to set
 * platform_admin, email or a role through this route — spec/05 requires the
 * API to reject unknown fields, and the RPC checks again independently.
 */
export const profilePatchSchema = z
  .object({
    display_name: z.string().trim().min(1).max(120).optional(),
    timezone: z.string().min(1).optional(),
    reminders_enabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field is required",
  });

export type ProfilePatch = z.infer<typeof profilePatchSchema>;

export async function getMe(): Promise<Me> {
  return meSchema.parse(await callRpc("get_me"));
}

export async function updateMe(patch: ProfilePatch): Promise<Me> {
  return meSchema.parse(await callRpc("update_me", patch));
}

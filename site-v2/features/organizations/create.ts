import { z } from "zod";
import { callRpc } from "@/lib/rpc";
import { serviceClient } from "@/lib/supabase/server";
import { organizationSchema, type Organization } from "./organizations";
import { normalizeEmail } from "./invitations";

/*
 * Creating an organization provisions its first manager at the same time.
 * spec/02: "Initial organization creation includes manager provisioning and
 * does not make organization usable until a manager membership exists."
 *
 * Like invitations, this spans Auth and Postgres, so the Auth identity is
 * established first and idempotently by email.
 */
export const organizationCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    timezone: z.string().min(1),
    manager_email: z.string().email().max(254),
    manager_name: z.string().trim().min(1).max(120),
  })
  .strict();

export type OrganizationCreate = z.infer<typeof organizationCreateSchema>;

export async function createOrganization(
  input: OrganizationCreate,
  requestId: string
): Promise<Organization> {
  const email = normalizeEmail(input.manager_email);
  const service = serviceClient();

  let managerId: string | undefined;
  for (let page = 1; page <= 20 && !managerId; page += 1) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`auth lookup failed: ${error.message}`);
    if (data.users.length === 0) break;
    managerId = data.users.find((u) => normalizeEmail(u.email ?? "") === email)?.id;
  }

  if (!managerId) {
    const { data, error } = await service.auth.admin.generateLink({ type: "invite", email });
    if (error || !data.user) throw new Error(`auth invite failed: ${error?.message ?? "no user"}`);
    managerId = data.user.id;
  }

  const { error: provisionError } = await service.rpc("pglearn_provision", {
    payload: { user_id: managerId, display_name: input.manager_name },
  });
  if (provisionError) throw new Error(`provisioning failed: ${provisionError.message}`);

  return organizationSchema.parse(
    await callRpc("create_organization", {
      request_id: requestId,
      name: input.name,
      timezone: input.timezone,
      manager_user_id: managerId,
    })
  );
}

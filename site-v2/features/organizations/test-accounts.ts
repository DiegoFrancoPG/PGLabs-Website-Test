import { z } from "zod";
import { callRpc, RpcError } from "@/lib/rpc";
import { getMe } from "@/features/identity/me";
import { listOrganizations } from "@/features/organizations/organizations";
import { normalizeEmail } from "@/lib/email-address";
import { serviceClient } from "@/lib/supabase/server";
import { findAuthUser } from "@/features/organizations/invitations";

/*
 * Test accounts with a password (D-21, M38), for the team's own testing while
 * invitation email is not set up. Only in a test organization (M33).
 *
 * Per person: the Auth account is found or created through the Auth admin
 * API (already confirmed, with the password), the profile is provisioned
 * from it, and create_test_account makes them an active member. An account
 * that already existed gets the new password only when the database says it
 * belongs to test organizations alone; a platform administrator or a member
 * of a real organization keeps their own.
 */

export const testAccountsSchema = z
  .object({
    accounts: z
      .array(
        z
          .object({
            email: z.string().trim().email().max(254),
            display_name: z.string().trim().min(1).max(120),
          })
          .strict()
      )
      .min(1)
      .max(20),
    role: z.enum(["learner", "manager"]),
    /** One password for everybody, or omitted to generate one each. */
    password: z.string().min(10).max(72).optional(),
  })
  .strict();

const createdSchema = z.object({
  user_id: z.string().uuid(),
  email: z.string(),
  role: z.enum(["learner", "manager"]),
  password_allowed: z.boolean(),
});

export interface TestAccountResult {
  email: string;
  outcome: "created" | "password_set" | "password_kept" | "failed";
  password: string | null;
  message?: string;
}

/* 14 characters from an alphabet without look-alikes (0/O, 1/l/I). */
export function generatePassword(): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(14));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export async function createTestAccounts(
  organizationId: string,
  input: z.infer<typeof testAccountsSchema>
): Promise<{ items: TestAccountResult[] }> {
  /*
   * Checked before any Auth account is touched: create_test_account checks
   * both again, but by then an account could already have been created.
   */
  if (!(await getMe()).platform_admin) throw new RpcError("FORBIDDEN", "Not permitted.");
  const organization = (await listOrganizations(100)).items.find((o) => o.id === organizationId);
  if (!organization) throw new RpcError("NOT_FOUND", "Not found.");
  if (!organization.is_test) {
    throw new RpcError("CONFLICT", "Test accounts can only be created in a test organization.");
  }

  const service = serviceClient();
  const items: TestAccountResult[] = [];

  // One at a time: the Auth lookups page through users, and 20 is the most.
  for (const account of input.accounts) {
    const email = normalizeEmail(account.email);
    const password = input.password ?? generatePassword();
    try {
      let userId = await findAuthUser(email);
      const created = userId === null;
      if (created) {
        const { data, error } = await service.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { display_name: account.display_name },
        });
        if (error || !data.user) throw new Error(error?.message ?? "the account could not be created");
        userId = data.user.id;
      }

      const { error: provisionError } = await service.rpc("pglearn_provision", {
        payload: { user_id: userId, display_name: account.display_name },
      });
      if (provisionError) throw new Error(provisionError.message);

      const result = createdSchema.parse(
        await callRpc("create_test_account", {
          organization_id: organizationId,
          user_id: userId,
          role: input.role,
        })
      );

      if (created) {
        items.push({ email, outcome: "created", password });
      } else if (result.password_allowed) {
        const { error } = await service.auth.admin.updateUserById(userId!, { password, email_confirm: true });
        if (error) throw new Error(error.message);
        items.push({ email, outcome: "password_set", password });
      } else {
        items.push({ email, outcome: "password_kept", password: null });
      }
    } catch (err) {
      items.push({
        email,
        outcome: "failed",
        password: null,
        // Auth's own messages (a weak password, say) help the administrator;
        // the database's are not returned (spec/05), only their code.
        message: err instanceof RpcError ? err.code : err instanceof Error ? err.message : "failed",
      });
    }
  }
  return { items };
}

/*
 * Managing a test account after it exists (D-25, M40): its role, whether it is
 * still in the organization, and a new password. Name and email are
 * update_member_profile's (M30), as for any member.
 */

export const testAccountPatchSchema = z
  .object({
    role: z.enum(["learner", "manager"]).optional(),
    status: z.enum(["active", "removed"]).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });

export const testAccountPasswordSchema = z
  .object({
    /** The new password, or omitted to generate one. */
    password: z.string().min(10).max(72).optional(),
  })
  .strict();

const managedSchema = z.object({
  user_id: z.string().uuid(),
  email: z.string(),
  display_name: z.string(),
  role: z.enum(["learner", "manager"]),
  status: z.enum(["invited", "active", "removed"]),
  password_allowed: z.boolean(),
});

export type ManagedTestAccount = z.infer<typeof managedSchema>;

/*
 * The administrator and test-organization checks, made here before Auth is
 * touched, as createTestAccounts makes them. The database repeats both.
 */
async function assertTestOrganization(organizationId: string): Promise<void> {
  if (!(await getMe()).platform_admin) throw new RpcError("FORBIDDEN", "Not permitted.");
  const organization = (await listOrganizations(100)).items.find((o) => o.id === organizationId);
  if (!organization) throw new RpcError("NOT_FOUND", "Not found.");
  if (!organization.is_test) {
    throw new RpcError("CONFLICT", "Only accounts in a test organization can be managed here.");
  }
}

export async function updateTestAccount(
  organizationId: string,
  userId: string,
  input: z.infer<typeof testAccountPatchSchema>
): Promise<Omit<ManagedTestAccount, "password_allowed">> {
  await assertTestOrganization(organizationId);
  try {
    const account = managedSchema.parse(
      await callRpc("update_test_account", { organization_id: organizationId, user_id: userId, ...input })
    );
    return {
      user_id: account.user_id,
      email: account.email,
      display_name: account.display_name,
      role: account.role,
      status: account.status,
    };
  } catch (err) {
    /*
     * The organization is a test one (checked above), so the business rule
     * that refused this is M02's: an active organization keeps a manager.
     */
    if (err instanceof RpcError && err.code === "CONFLICT") {
      throw new RpcError(
        "CONFLICT",
        "The organization would be left without a manager. Add or keep another manager first."
      );
    }
    throw err;
  }
}

export async function resetTestAccountPassword(
  organizationId: string,
  userId: string,
  input: z.infer<typeof testAccountPasswordSchema>
): Promise<{ email: string; password: string }> {
  await assertTestOrganization(organizationId);
  const account = managedSchema.parse(
    await callRpc("update_test_account", {
      organization_id: organizationId,
      user_id: userId,
      password_reset: true,
    })
  );
  // M38's rule: an administrator, or a member of a real organization, keeps
  // the password they chose.
  if (!account.password_allowed) {
    throw new RpcError(
      "CONFLICT",
      "This person also belongs to a real organization or is an administrator, so they keep their own password."
    );
  }
  const password = input.password ?? generatePassword();
  const { error } = await serviceClient().auth.admin.updateUserById(userId, { password, email_confirm: true });
  // Auth's own message (a weak password, say) helps the administrator.
  if (error) throw new RpcError("VALIDATION_ERROR", error.message);
  return { email: account.email, password };
}

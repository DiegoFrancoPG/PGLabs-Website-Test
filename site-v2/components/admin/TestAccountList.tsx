"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { EditMember } from "@/components/admin/EditMember";
import { Alert } from "@/components/pglearn/ui/alert";
import { Badge } from "@/components/pglearn/ui/badge";
import { Button } from "@/components/pglearn/ui/button";

/*
 * Every account in a test organization, and what an administrator can do with
 * each (D-25): correct the name or email (update_member_profile), change the
 * role, set a new password, and take the person out of the organization or
 * bring them back (update_test_account, M40). Accounts are created with
 * TestAccounts (D-21). A removed account keeps its records and is listed so
 * it can be restored; nothing here deletes an account.
 */

export interface TestAccountMember {
  user_id: string;
  display_name: string;
  email: string;
  role: "learner" | "manager";
  status: "invited" | "active" | "removed";
  onboarded: boolean;
}

export function TestAccountList({
  organizationId,
  members,
}: {
  organizationId: string;
  members: TestAccountMember[];
}) {
  if (members.length === 0) {
    return <p className="mt-2 text-ui-body text-ui-muted-foreground">No accounts yet.</p>;
  }
  return (
    <ul className="mt-2 flex flex-col divide-y divide-ui-border">
      {members.map((member) => (
        <TestAccountRow key={member.user_id} organizationId={organizationId} member={member} />
      ))}
    </ul>
  );
}

function TestAccountRow({ organizationId, member }: { organizationId: string; member: TestAccountMember }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [password, setPassword] = useState<string | null>(null);
  const removed = member.status === "removed";
  const base = `/api/v1/organizations/${organizationId}/test-accounts/${member.user_id}`;

  async function send(url: string, method: "PATCH" | "POST", body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? "Not permitted. If you are an administrator, the database update M40 may not be applied yet."
            : (json?.error?.message ?? "The change could not be saved.")
        );
      }
      return json.data as Record<string, unknown>;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setPending(false);
    }
  }

  async function update(patch: { role?: TestAccountMember["role"]; status?: "active" | "removed" }) {
    if (await send(base, "PATCH", patch)) {
      setConfirmRemove(false);
      router.refresh();
    }
  }

  async function resetPassword() {
    setPassword(null);
    const data = await send(`${base}/password`, "POST", {});
    if (data) setPassword(String(data.password));
  }

  return (
    <li className={`py-3 ${removed ? "opacity-70" : ""}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="min-w-0 flex-1">
          <span className="font-semibold text-ui-foreground">{member.display_name}</span>{" "}
          <Badge variant="outline">{member.role === "manager" ? "Manager" : "Learner"}</Badge>{" "}
          {removed && <Badge variant="coral">Removed</Badge>}{" "}
          {!removed && !member.onboarded && <Badge variant="outline">Not set up yet</Badge>}
          <br />
          <span className="text-ui-body text-ui-muted-foreground">{member.email}</span>
        </span>

        {!removed && (
          <>
            <EditMember userId={member.user_id} name={member.display_name} email={member.email} />
            <label className="sr-only" htmlFor={`role-${member.user_id}`}>
              Role for {member.display_name}
            </label>
            <select
              id={`role-${member.user_id}`}
              value={member.role}
              disabled={pending}
              onChange={(event) => update({ role: event.target.value as TestAccountMember["role"] })}
              className="pglearn-field"
            >
              <option value="learner">Learner</option>
              <option value="manager">Manager</option>
            </select>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={resetPassword}>
              Reset password<span className="sr-only"> for {member.display_name}</span>
            </Button>
            <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => setConfirmRemove(true)}>
              Remove<span className="sr-only"> {member.display_name}</span>
            </Button>
          </>
        )}
        {removed && (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => update({ status: "active" })}>
            Restore<span className="sr-only"> {member.display_name}</span>
          </Button>
        )}
      </div>

      {confirmRemove && (
        <div role="alertdialog" aria-label={`Remove ${member.display_name}`} className="mt-3 rounded-ui border border-ui-border p-4">
          <p className="text-ui-body">
            {member.display_name} will no longer be able to open this organization&apos;s programs. Their progress and
            certificates are kept, and you can restore them later.
          </p>
          <div className="mt-3 flex gap-3">
            <Button type="button" variant="primary" size="sm" disabled={pending} onClick={() => update({ status: "removed" })}>
              {pending ? "Removing…" : "Remove"}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setConfirmRemove(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {password && (
        <Alert variant="info" className="mt-3">
          <p>
            New password for {member.email}: <code className="font-mono">{password}</code>
          </p>
          <p className="mt-1 text-ui-muted-foreground">It is shown once. Pass it on now.</p>
        </Alert>
      )}
      {error && (
        <Alert variant="warning" className="mt-3" role="alert">
          {error}
        </Alert>
      )}
    </li>
  );
}

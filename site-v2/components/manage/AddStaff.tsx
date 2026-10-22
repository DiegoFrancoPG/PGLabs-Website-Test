"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { Alert } from "@/components/pglearn/ui/alert";
import { Button } from "@/components/pglearn/ui/button";
import { Card } from "@/components/pglearn/ui/card";
import { STAFF_COHORT_NAME } from "@/lib/staff";

/*
 * Adding a person to the organization's staff list.
 *
 * The PG Learn launch shows managers one staff list instead of cohorts, but
 * the data model still assigns learning to a cohort. So the staff list is one
 * cohort, "Staff", that the manager never has to name or choose: it is made
 * the first time somebody is added, and every later addition joins it.
 *
 * Then the same two steps as before: the invitation establishes who they are,
 * and adding them to the cohort says where they belong. Neither enrols them —
 * "New member is not auto-enrolled" — assigning a program is its own action.
 */

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return { ok: response.ok, json };
}

export function AddStaff({
  organizationId,
  cohortId,
}: {
  organizationId: string;
  /** The staff cohort, or null when nobody has been added yet. */
  cohortId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // Remembered once made, so a second addition in the same visit reuses it.
  const [staffCohortId, setStaffCohortId] = useState(cohortId);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setDone(null);
    try {
      let target = staffCohortId;
      if (!target) {
        const created = await postJson("/api/v1/cohorts", {
          organization_id: organizationId,
          name: STAFF_COHORT_NAME,
        });
        if (!created.ok) {
          throw new Error(created.json?.error?.message ?? "The staff list could not be set up.");
        }
        target = created.json.data.id as string;
        setStaffCohortId(target);
      }

      const invited = await postJson("/api/v1/invitations", {
        organization_id: organizationId,
        email,
        display_name: name,
        role: "learner",
      });
      if (!invited.ok) {
        throw new Error(invited.json?.error?.message ?? "The invitation could not be created.");
      }

      const added = await postJson(`/api/v1/cohorts/${target}/members`, {
        user_ids: [invited.json.data.user_id],
      });
      if (!added.ok) {
        throw new Error(
          added.json?.error?.message ?? "They were invited, but could not be added to the staff list."
        );
      }

      setDone(`${name} has been invited. Assign them a program to start their learning.`);
      setEmail("");
      setName("");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="primary" size="sm" onClick={() => setOpen(true)}>
        <UserPlus aria-hidden />
        Add people
      </Button>
    );
  }

  return (
    <Card className="w-full p-5">
      <form onSubmit={add}>
        <h3 className="font-heading text-ui-heading text-ui-foreground">Add a person</h3>
        <p className="mt-1 text-ui-body text-ui-muted-foreground">
          They get an email invitation to set a password and join PG Learn.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem] flex-1">
            <label htmlFor="staff-name" className="block text-ui-eyebrow uppercase text-ui-muted-foreground">
              Name
            </label>
            <input
              id="staff-name"
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full pglearn-field"
            />
          </div>
          <div className="min-w-[14rem] flex-1">
            <label htmlFor="staff-email" className="block text-ui-eyebrow uppercase text-ui-muted-foreground">
              Email
            </label>
            <input
              id="staff-email"
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-1 w-full pglearn-field"
            />
          </div>
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? "Adding…" : "Add"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>

        <div role="status" aria-live="polite">
          {done && (
            <Alert variant="info" className="mt-3">
              {done}
            </Alert>
          )}
        </div>
        {error && (
          <Alert variant="warning" className="mt-3" role="alert">
            {error}
          </Alert>
        )}
      </form>
    </Card>
  );
}

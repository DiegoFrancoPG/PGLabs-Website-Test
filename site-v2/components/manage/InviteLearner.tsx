"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@ds/components/ui/alert";
import { Button } from "@ds/components/ui/button";

/*
 * Inviting somebody and putting them in this cohort.
 *
 * Two operations, deliberately in this order: the invitation establishes who
 * they are, and adding them to the cohort says where they belong. spec/04:
 * "add invitation result to cohort" — so the second step uses the id the first
 * returned rather than asking the manager to find it.
 *
 * It does NOT enrol them. "New member is not auto-enrolled": assignment
 * carries dates and is its own decision.
 */
export function InviteLearner({
  organizationId,
  cohortId,
}: {
  organizationId: string;
  cohortId: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setDone(null);
    try {
      const invited = await fetch("/api/v1/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          organization_id: organizationId,
          email,
          display_name: name,
          role: "learner",
        }),
      });
      const invitation = await invited.json();
      if (!invited.ok) {
        throw new Error(invitation?.error?.message ?? "The invitation could not be created.");
      }

      const added = await fetch(`/api/v1/cohorts/${cohortId}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ user_ids: [invitation.data.user_id] }),
      });
      if (!added.ok) {
        const failure = await added.json();
        throw new Error(
          failure?.error?.message ??
            "They were invited, but could not be added to this cohort."
        );
      }

      setDone(`${name} has been invited and added to this cohort. They are not enrolled yet.`);
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
        Invite a learner
      </Button>
    );
  }

  return (
    <form onSubmit={invite}>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="invite-name" className="block text-label uppercase text-steel-500">
            Name
          </label>
          <input
            id="invite-name"
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 rounded-lg border border-steel-300 p-2 text-body-sm"
          />
        </div>
        <div>
          <label htmlFor="invite-email" className="block text-label uppercase text-steel-500">
            Email
          </label>
          <input
            id="invite-email"
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 rounded-lg border border-steel-300 p-2 text-body-sm"
          />
        </div>
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Inviting…" : "Invite"}
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
  );
}

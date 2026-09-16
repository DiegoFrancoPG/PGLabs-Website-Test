"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@ds/components/ui/alert";
import { Button } from "@ds/components/ui/button";
import { Card } from "@ds/components/ui/card";

/*
 * Creating an organization provisions its first manager at the same time.
 *
 * spec/02: an organization "does not become usable until a manager membership
 * exists", so the two are one action rather than two — and spec/04 asks for
 * the provisioning outcome to be explicit, which is why the result says what
 * happened to the manager rather than only that the organization exists.
 *
 * No invitation link is shown. It goes by email, and lives only in the private
 * outbox payload (spec/04: "no secret email links").
 */
export function NewOrganization() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [managerEmail, setManagerEmail] = useState("");
  const [managerName, setManagerName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setDone(null);
    try {
      const response = await fetch("/api/v1/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": requestId },
        body: JSON.stringify({
          name,
          timezone,
          manager_email: managerEmail,
          manager_name: managerName,
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "It could not be created.");

      setDone(
        `${json.data.name} was created. ${managerName} has been invited by email and confirms their own account.`
      );
      setName("");
      setManagerEmail("");
      setManagerName("");
      // A fresh key: the next organization is a new request, not a retry.
      setRequestId(crypto.randomUUID());
      router.refresh();
    } catch (err) {
      // The input is kept, so a failure does not cost somebody their typing.
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        New organization
      </Button>
    );
  }

  return (
    <Card className="p-5">
      <form onSubmit={create}>
        <h2 className="font-display text-h5 text-ink-800">New organization</h2>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" id="org-name">
            <input
              id="org-name"
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-lg border border-steel-300 p-2 text-body-sm"
            />
          </Field>

          <Field label="Timezone" id="org-timezone">
            <input
              id="org-timezone"
              required
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
              placeholder="Europe/Madrid"
              className="w-full rounded-lg border border-steel-300 p-2 text-body-sm"
            />
          </Field>

          <Field label="First manager's name" id="org-manager-name">
            <input
              id="org-manager-name"
              required
              maxLength={120}
              value={managerName}
              onChange={(event) => setManagerName(event.target.value)}
              className="w-full rounded-lg border border-steel-300 p-2 text-body-sm"
            />
          </Field>

          <Field label="First manager's email" id="org-manager-email">
            <input
              id="org-manager-email"
              type="email"
              required
              maxLength={254}
              value={managerEmail}
              onChange={(event) => setManagerEmail(event.target.value)}
              className="w-full rounded-lg border border-steel-300 p-2 text-body-sm"
            />
          </Field>
        </div>

        <div className="mt-5 flex gap-3">
          <Button type="submit" variant="primary" size="sm" disabled={pending}>
            {pending ? "Creating…" : "Create organization"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>

        <div role="status" aria-live="polite">
          {done && (
            <Alert variant="info" className="mt-4">
              {done}
            </Alert>
          )}
        </div>
        {error && (
          <Alert variant="warning" className="mt-4" role="alert">
            {error}
          </Alert>
        )}
      </form>
    </Card>
  );
}

function Field({
  label,
  id,
  children,
}: {
  label: string;
  id: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id} className="block text-label uppercase text-steel-500">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

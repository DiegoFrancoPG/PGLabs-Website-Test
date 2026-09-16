"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@ds/components/ui/alert";
import { Button } from "@ds/components/ui/button";
import { Card } from "@ds/components/ui/card";

/*
 * Inviting one person and giving them a programme of their own.
 *
 * Three operations in a row, and each is the previous one's reason for
 * existing: the invitation establishes an identity, the grant says what that
 * person may learn, and the enrolment says by when. None of them mentions an
 * organization — spec/04: "no fake organization required".
 *
 * If the middle step fails, the person still exists and has been invited; the
 * message says so rather than implying nothing happened, because inviting
 * somebody is not undone by a later failure.
 */
export function InviteIndividual({
  programs,
}: {
  programs: { id: string; title: string; versionId: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [programId, setProgramId] = useState(programs[0]?.id ?? "");
  const [startsAt, setStartsAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [dueAt, setDueAt] = useState("");
  const [accessEndsAt, setAccessEndsAt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function enrol(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setDone(null);

    const program = programs.find((candidate) => candidate.id === programId);
    if (!program) {
      setError("Choose a programme.");
      setPending(false);
      return;
    }

    let invitedName = name;
    try {
      // 1. Who they are. organization_id is null: this is the whole point.
      const invited = await fetch("/api/v1/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          email,
          display_name: name,
          organization_id: null,
          role: "learner",
        }),
      });
      const invitation = await invited.json();
      if (!invited.ok) {
        throw new Error(invitation?.error?.message ?? "The invitation could not be created.");
      }
      invitedName = name;

      // 2. What they may learn.
      const granted = await fetch("/api/v1/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          program_id: program.id,
          organization_id: null,
          user_id: invitation.data.user_id,
          starts_at: `${startsAt}T00:00:00.000Z`,
          ends_at: accessEndsAt ? `${accessEndsAt}T00:00:00.000Z` : null,
        }),
      });
      const grant = await granted.json();
      if (!granted.ok) {
        throw new Error(
          `${invitedName} has been invited, but the grant failed: ${
            grant?.error?.message ?? "unknown reason"
          }`
        );
      }

      // 3. By when.
      const enrolled = await fetch("/api/v1/enrollments/personal", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          grant_id: grant.data.id,
          version_id: program.versionId,
          starts_at: `${startsAt}T00:00:00.000Z`,
          due_at: `${dueAt}T23:59:59.000Z`,
          access_ends_at: accessEndsAt ? `${accessEndsAt}T00:00:00.000Z` : null,
        }),
      });
      const enrollment = await enrolled.json();
      if (!enrolled.ok) {
        throw new Error(
          `${invitedName} has been invited and granted ${program.title}, but the enrolment failed: ${
            enrollment?.error?.message ?? "unknown reason"
          }`
        );
      }

      setDone(
        `${invitedName} has been invited, granted ${program.title} and enrolled, due ${dueAt}. They confirm their own account from the email.`
      );
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
      <Button type="button" variant="primary" onClick={() => setOpen(true)}>
        Invite an individual
      </Button>
    );
  }

  return (
    <Card className="p-5">
      <form onSubmit={enrol}>
        <h2 className="font-display text-h5 text-ink-800">Invite an individual</h2>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name" id="individual-name">
            <input
              id="individual-name"
              required
              maxLength={120}
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-lg border border-steel-300 p-2 text-body-sm"
            />
          </Field>

          <Field label="Email" id="individual-email">
            <input
              id="individual-email"
              type="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-lg border border-steel-300 p-2 text-body-sm"
            />
          </Field>

          <Field label="Program" id="individual-program">
            <select
              id="individual-program"
              value={programId}
              onChange={(event) => setProgramId(event.target.value)}
              className="w-full rounded-lg border border-steel-300 p-2 text-body-sm"
            >
              {programs.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.title}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Starts" id="individual-starts">
            <input
              id="individual-starts"
              type="date"
              required
              value={startsAt}
              onChange={(event) => setStartsAt(event.target.value)}
              className="w-full rounded-lg border border-steel-300 p-2 text-body-sm"
            />
          </Field>

          <Field label="Due" id="individual-due">
            <input
              id="individual-due"
              type="date"
              required
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
              className="w-full rounded-lg border border-steel-300 p-2 text-body-sm"
            />
          </Field>

          <Field label="Access ends (optional)" id="individual-access">
            <input
              id="individual-access"
              type="date"
              value={accessEndsAt}
              onChange={(event) => setAccessEndsAt(event.target.value)}
              className="w-full rounded-lg border border-steel-300 p-2 text-body-sm"
            />
          </Field>
        </div>

        <div className="mt-5 flex gap-3">
          <Button type="submit" variant="primary" size="sm" disabled={pending || dueAt === ""}>
            {pending ? "Working…" : "Invite and enrol"}
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

"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/pglearn/ui/alert";
import { Button } from "@/components/pglearn/ui/button";

/*
 * Correcting a member's name or sign-in email (update_member_profile). Only
 * what changed is sent. A new email is the address they sign in with from then
 * on, which the form says before it is saved.
 */
export function EditMember({
  userId,
  name: initialName,
  email: initialEmail,
}: {
  userId: string;
  name: string;
  email: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const emailChanged = email.trim().toLowerCase() !== initialEmail;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const patch: Record<string, string> = {};
    if (name.trim() !== initialName) patch.display_name = name.trim();
    if (emailChanged) patch.email = email.trim();
    if (Object.keys(patch).length === 0) {
      setOpen(false);
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/users/${userId}/profile`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify(patch),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error?.message ?? "The changes could not be saved.");
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPending(false);
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Edit<span className="sr-only"> {initialName}</span>
      </Button>
    );
  }

  return (
    <form onSubmit={save} className="mt-2 w-full rounded-ui border border-ui-border p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`member-name-${userId}`} className="block text-ui-eyebrow uppercase text-ui-muted-foreground">
            Name
          </label>
          <input
            id={`member-name-${userId}`}
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full pglearn-field"
          />
        </div>
        <div>
          <label htmlFor={`member-email-${userId}`} className="block text-ui-eyebrow uppercase text-ui-muted-foreground">
            Email
          </label>
          <input
            id={`member-email-${userId}`}
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full pglearn-field"
          />
        </div>
      </div>
      {emailChanged && (
        <p className="mt-3 text-ui-body text-ui-muted-foreground">
          They will sign in with the new address from now on.
        </p>
      )}
      <div className="mt-4 flex gap-3">
        <Button type="submit" variant="primary" size="sm" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            setOpen(false);
            setName(initialName);
            setEmail(initialEmail);
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
      {error && (
        <Alert variant="warning" className="mt-3" role="alert">
          {error}
        </Alert>
      )}
    </form>
  );
}

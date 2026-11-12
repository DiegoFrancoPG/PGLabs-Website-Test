"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { derivedKey } from "@/lib/derived-key";
import { Alert } from "@/components/pglearn/ui/alert";
import { Button } from "@/components/pglearn/ui/button";

/*
 * Resending every expired invitation in an organization at once (D-30). It
 * invents nothing: each one is the existing resend (POST
 * /invitations/{id}/resend), which replaces the invitation with a fresh 7-day
 * one and sends the email, exactly as a single resend does.
 *
 * Each request's Idempotency-Key is derived from the expired invitation's id,
 * so pressing the button again after an interruption replays what already
 * went out instead of sending anybody a second email.
 */

export interface ExpiredInvitation {
  invitationId: string;
  name: string;
  email: string;
}

interface Outcome {
  sent: number;
  notSent: { name: string; reason: string }[];
}

export function ResendExpiredInvitations({ invitations }: { invitations: ExpiredInvitation[] }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(0);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  if (invitations.length === 0 && !outcome) return null;

  async function resendAll() {
    setPending(true);
    setDone(0);
    const result: Outcome = { sent: 0, notSent: [] };
    // One at a time: each sends an email, and the provider is happier with a
    // steady trickle than a burst.
    for (const invitation of invitations) {
      try {
        const response = await fetch(`/api/v1/invitations/${invitation.invitationId}/resend`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": await derivedKey("resend-expired", invitation.invitationId),
          },
          body: JSON.stringify({}),
        });
        const json = await response.json().catch(() => null);
        if (!response.ok) {
          result.notSent.push({ name: invitation.name, reason: json?.error?.message ?? "Not resent." });
        } else if (json?.data?.delivery_status === "accepted") {
          result.sent += 1;
        } else {
          // No delivery status: this press sent nothing, either because a
          // previous press already did (a replay) or because the email failed.
          result.notSent.push({
            name: invitation.name,
            reason:
              json?.data?.delivery_status === undefined
                ? "No email went out this time; it may already have been sent."
                : `The email was not confirmed as sent (${json.data.delivery_status}).`,
          });
        }
      } catch {
        result.notSent.push({ name: invitation.name, reason: "The request did not complete. Try again." });
      }
      setDone((count) => count + 1);
    }
    setOutcome(result);
    setPending(false);
    setConfirming(false);
    router.refresh();
  }

  return (
    <div className="mt-3">
      {invitations.length > 0 && !confirming && (
        <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
          Resend expired invitations ({invitations.length})
        </Button>
      )}

      {confirming && (
        <div
          role="alertdialog"
          aria-label="Resend expired invitations"
          className="rounded-ui border border-ui-border p-4"
        >
          <p className="text-ui-body">
            {invitations.length === 1 ? "1 person" : `${invitations.length} people`} will get a new invitation email
            with a link valid for 7 days:
          </p>
          <p className="mt-2 text-ui-body text-ui-muted-foreground">
            {invitations.map((invitation) => invitation.name).join(", ")}
          </p>
          <div className="mt-3 flex gap-3">
            <Button type="button" variant="primary" size="sm" disabled={pending} onClick={resendAll}>
              {pending ? `Sending… ${done} of ${invitations.length}` : "Resend all"}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {outcome && (
        <Alert variant={outcome.notSent.length > 0 ? "warning" : "info"} className="mt-3" role="status">
          <p>
            {outcome.sent === 1 ? "1 invitation" : `${outcome.sent} invitations`} resent.
          </p>
          {outcome.notSent.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {outcome.notSent.map((item) => (
                <li key={item.name}>
                  {item.name}: {item.reason}
                </li>
              ))}
            </ul>
          )}
        </Alert>
      )}
    </div>
  );
}

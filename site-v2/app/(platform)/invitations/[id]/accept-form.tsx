"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@ds/components/ui/button";
import { Alert } from "@ds/components/ui/alert";
import { accept } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" className="w-full" disabled={pending}>
      {pending ? "Accepting…" : "Accept invitation"}
    </Button>
  );
}

export function AcceptForm({ invitationId }: { invitationId: string }) {
  const [state, action] = useActionState(accept, {} as { error?: string });

  return (
    <form action={action} className="mt-8 flex flex-col gap-4">
      {state.error && <Alert variant="error">{state.error}</Alert>}
      <input type="hidden" name="invitation_id" value={invitationId} />
      <SubmitButton />
    </form>
  );
}

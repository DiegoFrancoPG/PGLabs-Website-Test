"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@ds/components/ui/button";
import { Input } from "@ds/components/ui/input";
import { Label } from "@ds/components/ui/label";
import { Alert } from "@ds/components/ui/alert";
import { requestReset } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" className="w-full" disabled={pending}>
      {pending ? "Sending…" : "Send reset link"}
    </Button>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestReset, { sent: false } as {
    sent: boolean;
    error?: string;
  });

  /*
   * The confirmation is deliberately the same for every address. It says a link
   * was sent "if that address has an account", which is true and reveals
   * nothing about which addresses do.
   */
  if (state.sent) {
    return (
      <Alert variant="success" className="mt-8">
        If that address has a PGLearn account, we have sent it a reset link. The link expires in 24
        hours.
      </Alert>
    );
  }

  return (
    <form action={action} className="mt-8 flex flex-col gap-5" noValidate>
      {state.error && <Alert variant="error">{state.error}</Alert>}
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email address</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <SubmitButton />
    </form>
  );
}

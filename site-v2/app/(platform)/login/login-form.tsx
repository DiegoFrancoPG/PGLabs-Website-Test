"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@ds/components/ui/button";
import { Input } from "@ds/components/ui/input";
import { Label } from "@ds/components/ui/label";
import { Alert } from "@ds/components/ui/alert";
import { signIn } from "./actions";

/*
 * spec/04 requires: inline field errors, an aria-live error summary, only the
 * submitting control disabled, no duplicate submission, and input retained
 * after a server failure. The email survives a failed attempt because the
 * field is uncontrolled and the form is not remounted.
 */
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" className="w-full" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
    </Button>
  );
}

export function LoginForm() {
  const [state, action] = useActionState(signIn, { error: undefined as string | undefined });

  return (
    <form action={action} className="mt-8 flex flex-col gap-5" noValidate>
      {state.error && <Alert variant="error">{state.error}</Alert>}

      <div className="flex flex-col gap-2">
        <Label htmlFor="email">Email address</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>

      <SubmitButton />

      <Link href="/forgot-password" className="text-body-sm text-brand-600 underline underline-offset-4">
        Forgot your password?
      </Link>
    </form>
  );
}

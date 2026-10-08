"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/pglearn/ui/button";
import { Input } from "@/components/pglearn/ui/input";
import { Label } from "@/components/pglearn/ui/label";
import { Alert } from "@/components/pglearn/ui/alert";
import { setPassword, type SetPasswordState } from "./actions";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" className="w-full" disabled={pending}>
      {pending ? "Saving…" : "Set password and continue"}
    </Button>
  );
}

export function SetPasswordForm({ next }: { next: string }) {
  const [state, action] = useActionState<SetPasswordState, FormData>(setPassword, {});

  return (
    <form action={action} className="mt-8 flex flex-col gap-5" noValidate>
      {state.error && <Alert variant="error">{state.error}</Alert>}
      <input type="hidden" name="next" value={next} />

      <div className="flex flex-col gap-2">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={12}
          maxLength={128}
          required
          aria-describedby={state.fieldErrors?.password ? "password-error" : undefined}
        />
        {state.fieldErrors?.password && (
          <p id="password-error" className="text-sm text-ui-destructive">
            {state.fieldErrors.password}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          aria-describedby={state.fieldErrors?.confirm ? "confirm-error" : undefined}
        />
        {state.fieldErrors?.confirm && (
          <p id="confirm-error" className="text-sm text-ui-destructive">
            {state.fieldErrors.confirm}
          </p>
        )}
      </div>

      <SubmitButton />
    </form>
  );
}

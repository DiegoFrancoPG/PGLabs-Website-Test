"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@ds/components/ui/button";
import { Input } from "@ds/components/ui/input";
import { Label } from "@ds/components/ui/label";
import { Alert } from "@ds/components/ui/alert";
import { Checkbox } from "@ds/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@ds/components/ui/select";
import { saveSettings, type SettingsState } from "./actions";

interface Props {
  profile: {
    email: string;
    display_name: string;
    timezone: string;
    reminders_enabled: boolean;
  };
  timezones: string[];
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="primary" disabled={pending}>
      {pending ? "Saving…" : "Save settings"}
    </Button>
  );
}

export function SettingsForm({ profile, timezones }: Props) {
  const [state, action] = useActionState<SettingsState, FormData>(saveSettings, { status: "idle" });

  return (
    <form action={action} className="mt-10 flex flex-col gap-7">
      {/* aria-live is built into Alert, so a save result is announced. */}
      {state.status !== "idle" && state.message && (
        <Alert variant={state.status === "saved" ? "success" : "error"}>{state.message}</Alert>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="display_name">Display name</Label>
        <Input
          id="display_name"
          name="display_name"
          defaultValue={profile.display_name}
          maxLength={120}
          required
          aria-describedby={state.fieldErrors?.display_name ? "display_name-error" : undefined}
        />
        {state.fieldErrors?.display_name && (
          <p id="display_name-error" className="text-body-sm text-coral-500">
            {state.fieldErrors.display_name}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="timezone">Timezone</Label>
        <Select name="timezone" defaultValue={profile.timezone}>
          <SelectTrigger id="timezone">
            <SelectValue placeholder="Choose a timezone" />
          </SelectTrigger>
          <SelectContent>
            {timezones.map((zone) => (
              <SelectItem key={zone} value={zone}>
                {zone}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {state.fieldErrors?.timezone && (
          <p className="text-body-sm text-coral-500">{state.fieldErrors.timezone}</p>
        )}
        <p className="text-body-sm text-steel-500">
          Due dates and reminders are shown in this timezone.
        </p>
      </div>

      <div className="flex items-start gap-3">
        <Checkbox id="reminders_enabled" name="reminders_enabled" defaultChecked={profile.reminders_enabled} />
        <Label htmlFor="reminders_enabled" className="normal-case tracking-normal text-body-sm">
          Email me learning reminders
        </Label>
      </div>

      {/*
        spec/04: "role/email never editable here." The address is shown so the
        user knows which account they are in, and is not a form control.
      */}
      <div className="border-t border-steel-200 pt-6">
        <p className="text-label uppercase text-ink-700">Email address</p>
        <p className="mt-1 text-body-sm text-steel-500">{profile.email}</p>
        <p className="mt-2 text-body-sm text-steel-500">
          Your email address comes from your account and cannot be changed here.
        </p>
      </div>

      <div>
        <SaveButton />
      </div>
    </form>
  );
}

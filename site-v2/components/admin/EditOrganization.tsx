"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { Alert } from "@/components/pglearn/ui/alert";
import { Button } from "@/components/pglearn/ui/button";

/*
 * An organization's name and timezone, edited in place on its card
 * (update_organization). The timezone is chosen from the runtime's IANA list,
 * so a typo cannot be saved; the database checks it again.
 */
export function EditOrganization({
  organizationId,
  name: initialName,
  timezone: initialTimezone,
  timezones,
}: {
  organizationId: string;
  name: string;
  timezone: string;
  timezones: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A timezone saved before the list existed still shows as the selected one.
  const options = timezones.includes(initialTimezone) ? timezones : [initialTimezone, ...timezones];

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ name, timezone }),
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
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Pencil aria-hidden />
        Edit organization
      </Button>
    );
  }

  return (
    <form onSubmit={save} className="w-full rounded-ui border border-ui-border p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`org-name-${organizationId}`} className="block text-ui-eyebrow uppercase text-ui-muted-foreground">
            Name
          </label>
          <input
            id={`org-name-${organizationId}`}
            required
            maxLength={120}
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="mt-1 w-full pglearn-field"
          />
        </div>
        <div>
          <label htmlFor={`org-tz-${organizationId}`} className="block text-ui-eyebrow uppercase text-ui-muted-foreground">
            Timezone
          </label>
          <select
            id={`org-tz-${organizationId}`}
            value={timezone}
            onChange={(event) => setTimezone(event.target.value)}
            className="mt-1 w-full pglearn-field"
          >
            {options.map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </div>
      </div>
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
            setTimezone(initialTimezone);
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

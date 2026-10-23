"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/pglearn/ui/alert";
import { Button } from "@/components/pglearn/ui/button";
import { Card } from "@/components/pglearn/ui/card";

/*
 * Test accounts with a password (D-21), shown on a test organization only.
 * One person per line, "Name, email" or just the email. The passwords are
 * shown once, here, for the administrator to pass on; they are not stored
 * anywhere the application can show them again.
 */

interface Result {
  email: string;
  outcome: "created" | "password_set" | "password_kept" | "failed";
  password: string | null;
  message?: string;
}

function parse(text: string) {
  return text
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[,;\t]/).map((part) => part.trim()).filter(Boolean);
      const email = parts.find((part) => part.includes("@")) ?? "";
      const name =
        parts.find((part) => !part.includes("@")) ??
        email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      return { email, display_name: name };
    });
}

const OUTCOME: Record<Result["outcome"], string> = {
  created: "Created",
  password_set: "Existing account, password set",
  password_kept: "Existing account, kept its own password",
  failed: "Failed",
};

export function TestAccounts({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [role, setRole] = useState<"learner" | "manager">("learner");
  const [shared, setShared] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Result[] | null>(null);
  const people = parse(text);
  const invalid = people.filter((person) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(person.email));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setResults(null);
    try {
      const response = await fetch(`/api/v1/organizations/${organizationId}/test-accounts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ accounts: people, role, ...(shared ? { password: shared } : {}) }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(
          response.status === 403
            ? "Not permitted. If you are an administrator, the database update M38 may not be applied yet."
            : (json?.error?.message ?? "The accounts could not be created.")
        );
      }
      const items = json.data.items as Result[];
      if (items.every((item) => item.outcome === "failed" && item.message === "FORBIDDEN")) {
        throw new Error("Not permitted. The database update M38 may not be applied yet.");
      }
      setResults(items);
      setText("");
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
        Create test accounts
      </Button>
    );
  }

  return (
    <Card className="mt-3 w-full p-5">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <h3 className="font-heading text-ui-heading text-ui-foreground">Create test accounts</h3>
          <p className="mt-1 text-ui-body text-ui-muted-foreground">
            For your team&rsquo;s testing. They can sign in straight away with the password, without an
            invitation email. Only possible in a test organization.
          </p>
        </div>

        <div>
          <label htmlFor={`accounts-${organizationId}`} className="block text-ui-eyebrow uppercase text-ui-muted-foreground">
            People, one per line
          </label>
          <textarea
            id={`accounts-${organizationId}`}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={5}
            placeholder={"Alysha, alysha@peacegeeks.org\njen@peacegeeks.org"}
            className="mt-1 w-full pglearn-field font-mono"
          />
          <p className="mt-1 text-ui-body text-ui-muted-foreground">
            &ldquo;Name, email&rdquo; or just the email. Up to 20 at a time.
            {invalid.length > 0 && <span className="text-ui-destructive"> {invalid.length} line(s) have no valid email.</span>}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`role-${organizationId}`} className="block text-ui-eyebrow uppercase text-ui-muted-foreground">
              Role
            </label>
            <select
              id={`role-${organizationId}`}
              value={role}
              onChange={(event) => setRole(event.target.value as "learner" | "manager")}
              className="mt-1 w-full pglearn-field"
            >
              <option value="learner">Learner (added to the staff list)</option>
              <option value="manager">Manager</option>
            </select>
          </div>
          <div>
            <label htmlFor={`password-${organizationId}`} className="block text-ui-eyebrow uppercase text-ui-muted-foreground">
              Password (optional)
            </label>
            <input
              id={`password-${organizationId}`}
              value={shared}
              onChange={(event) => setShared(event.target.value)}
              minLength={10}
              maxLength={72}
              autoComplete="off"
              placeholder="Leave empty to generate one each"
              className="mt-1 w-full pglearn-field"
            />
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={pending || people.length === 0 || invalid.length > 0 || people.length > 20}
          >
            {pending ? "Creating…" : `Create ${people.length || ""} account${people.length === 1 ? "" : "s"}`}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </div>

        {error && (
          <Alert variant="warning" role="alert">
            {error}
          </Alert>
        )}

        {results && (
          <div role="status">
            <Alert variant="info">Copy the passwords now: they are not shown again.</Alert>
            <table className="mt-3 w-full text-left text-ui-body">
              <thead className="text-ui-eyebrow uppercase text-ui-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-normal">Email</th>
                  <th className="py-1 pr-3 font-normal">Password</th>
                  <th className="py-1 font-normal">Result</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ui-border">
                {results.map((result) => (
                  <tr key={result.email}>
                    <td className="py-2 pr-3">{result.email}</td>
                    <td className="py-2 pr-3 font-mono">{result.password ?? "—"}</td>
                    <td className="py-2">
                      {OUTCOME[result.outcome]}
                      {result.outcome === "failed" && result.message ? ` (${result.message})` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3"
              onClick={() =>
                void navigator.clipboard.writeText(
                  results
                    .filter((result) => result.password)
                    .map((result) => `${result.email}\t${result.password}`)
                    .join("\n")
                )
              }
            >
              Copy emails and passwords
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

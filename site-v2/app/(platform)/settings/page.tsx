import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { getMe } from "@/features/identity/me";
import { SettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  if (!(await verifiedUser())) redirect("/login?next=/settings");

  const me = await getMe();
  /*
   * The IANA zone list comes from the runtime rather than a bundled table, so
   * it cannot drift from what Postgres accepts. The database validates against
   * pg_timezone_names regardless (M02).
   */
  const timezones = Intl.supportedValuesOf("timeZone");

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-h2-sm text-ink-800">Settings</h1>
      <SettingsForm profile={me.profile} timezones={timezones} />
    </main>
  );
}

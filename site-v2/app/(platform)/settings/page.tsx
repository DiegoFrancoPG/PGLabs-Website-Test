import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { getMe } from "@/features/identity/me";
import { SettingsForm } from "./settings-form";
import { AppShell } from "@/components/layout/AppShell";
import { pageContainer } from "@/components/pglearn/layout";

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
    <AppShell active="settings">
    <main className={`${pageContainer} py-16 [&>*]:max-w-2xl`}>
      <h1 className="font-heading text-2xl font-semibold tracking-tight text-ui-foreground">Settings</h1>
      <SettingsForm profile={me.profile} timezones={timezones} />
    </main>
    </AppShell>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { getMe } from "@/features/identity/me";
import { AppShell } from "@/components/layout/AppShell";
import { Alert } from "@ds/components/ui/alert";
import { Card } from "@ds/components/ui/card";

/*
 * Choosing which organization to manage.
 *
 * spec/04: "A multi-organization manager explicitly selects an organization;
 * show the selected name in all manager screens and export context."
 *
 * Explicitly is the word. Somebody who manages two clients must not be shown
 * one of them because it happened to sort first — a report exported from the
 * wrong organization is a confidentiality problem, not an inconvenience.
 */

export const metadata: Metadata = { title: "Organizations" };

export default async function ManageIndexPage() {
  if (!(await verifiedUser())) redirect("/login?next=/manage");

  const me = await getMe();
  const managed = me.contexts.filter(
    (context) => context.role === "manager" && context.status === "active"
  );

  // One organization needs no choice; go straight there.
  if (managed.length === 1) redirect(`/manage/${managed[0].organization_id}`);

  return (
    <AppShell active="manage">
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="font-display text-h2-sm text-ink-800">Choose an organization</h1>

        {managed.length === 0 ? (
          <Alert variant="info" className="mt-6">
            You do not manage an organization. If you expected to, ask a platform administrator to
            check your membership.
          </Alert>
        ) : (
          <>
            <p className="mt-2 text-body-sm text-steel-500">
              Everything you see afterwards — including any export — belongs to the organization you
              pick here.
            </p>
            <div className="mt-8 flex flex-col gap-4">
              {managed.map((context) => (
                <Card key={context.organization_id} className="p-5">
                  <Link
                    href={`/manage/${context.organization_id}`}
                    className="font-display text-h5 text-brand-600 underline underline-offset-4"
                  >
                    {context.organization_name}
                  </Link>
                </Card>
              ))}
            </div>
          </>
        )}
      </main>
    </AppShell>
  );
}

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { getMe } from "@/features/identity/me";
import { signOut } from "../login/actions";
import { Button } from "@ds/components/ui/button";

/*
 * Placeholder. The real learner dashboard — program cards, counts, due dates,
 * locked-card reasons — is T12. This exists now because spec/04 sends a
 * successful sign-in here, and because AC-007 needs a protected page to prove
 * an anonymous visitor is redirected.
 */

export const metadata: Metadata = { title: "Your learning" };

export default async function LearnPage() {
  if (!(await verifiedUser())) redirect("/login?next=/learn");
  const me = await getMe();

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-h2-sm text-ink-800">Your learning</h1>
      <p className="mt-3 text-body-sm text-steel-500">Signed in as {me.profile.email}</p>

      {/* spec/04's empty state wording for a learner with no enrollments. */}
      <p className="mt-10 text-body-lg">You haven&rsquo;t been assigned a program yet.</p>

      <div className="mt-10 flex gap-3">
        <Button variant="outline" asChild>
          <a href="/settings">Settings</a>
        </Button>
        <form action={signOut}>
          <Button type="submit" variant="subtle">
            Sign out
          </Button>
        </form>
      </div>
    </main>
  );
}

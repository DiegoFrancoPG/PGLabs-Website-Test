import Link from "next/link";
import { getMe } from "@/features/identity/me";
import { signOut } from "@/app/(platform)/login/actions";
import { Button } from "@ds/components/ui/button";

/*
 * The one application shell (spec/04).
 *
 * "One application shell: Learner navigation for enrolled content/certificates,
 * Organization navigation when manager, Admin navigation for platform admin. A
 * multi-organization manager explicitly selects an organization; show the
 * selected name in all manager screens and export context. Scope is rechecked
 * by server."
 *
 * The navigation is built from `get_me`, which returns the caller's own
 * contexts and admin flag. It is a convenience, not a control: every screen it
 * links to re-establishes the caller's rights from the database, so a
 * navigation item that should not be there would still lead to a refusal
 * rather than to somebody else's data.
 */

export async function AppShell({
  children,
  active,
}: {
  children: React.ReactNode;
  /** Which top-level area is being shown, for aria-current. */
  active?: "learn" | "manage" | "admin" | "settings";
}) {
  const me = await getMe();

  const managed = me.contexts.filter(
    (context) => context.role === "manager" && context.status === "active"
  );

  return (
    <div className="min-h-screen bg-surface">
      <header className="border-b border-steel-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-3 px-6 py-4">
          <Link href="/learn" className="font-display text-h5 text-brand-600">
            PGLearn
          </Link>

          <nav aria-label="Main" className="flex flex-1 flex-wrap items-center gap-x-5 gap-y-2">
            <NavLink href="/learn" current={active === "learn"}>
              My learning
            </NavLink>

            {/*
              * A manager of exactly one organization is taken straight to it.
              * A manager of several must choose, which is why they get a list
              * rather than a guess — spec/04: "A multi-organization manager
              * explicitly selects an organization."
              */}
            {managed.length === 1 && (
              <NavLink href={`/manage/${managed[0].organization_id}`} current={active === "manage"}>
                {managed[0].organization_name}
              </NavLink>
            )}
            {managed.length > 1 && (
              <NavLink href="/manage" current={active === "manage"}>
                Organizations
              </NavLink>
            )}

            {me.platform_admin && (
              <>
                <NavLink href="/admin/programs" current={active === "admin"}>
                  Programs
                </NavLink>
                <NavLink href="/admin/organizations">Organizations</NavLink>
                <NavLink href="/admin/individuals">Individuals</NavLink>
                <NavLink href="/admin/reports">Reports</NavLink>
                <NavLink href="/admin/operations">Operations</NavLink>
              </>
            )}
            {/* Settings is navigation, so it lives inside the landmark rather
                than beside it — a screen reader listing the navigation should
                find every place this person can go. */}
            <NavLink href="/settings" current={active === "settings"} className="ml-auto">
              Settings
            </NavLink>
          </nav>

          {/* Signing out is an action, not a destination. */}
          <form action={signOut}>
            <Button type="submit" variant="subtle" size="sm">
              Sign out
            </Button>
          </form>
        </div>
      </header>

      {children}
    </div>
  );
}

function NavLink({
  href,
  current,
  children,
  className = "",
}: {
  href: string;
  current?: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Link
      href={href}
      // aria-current is what tells a screen reader which page this is, and it
      // is also what the visible underline is keyed to — one source, not two.
      aria-current={current ? "page" : undefined}
      className={`text-body-sm underline-offset-4 hover:underline ${
        current ? "font-semibold text-ink-800 underline" : "text-steel-500"
      } ${className}`}
    >
      {children}
    </Link>
  );
}

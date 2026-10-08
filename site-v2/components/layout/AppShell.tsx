import Link from "next/link";
import { cookies } from "next/headers";
import { LogOut } from "lucide-react";
import { getMe } from "@/features/identity/me";
import { signOut } from "@/app/(platform)/login/actions";
import { Button } from "@/components/pglearn/ui/button";
import { Logo } from "@/components/pglearn/Logo";
import { ThemeToggle } from "@/components/pglearn/ThemeToggle";
import { THEME_COOKIE, parseTheme } from "@/components/pglearn/theme";

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
  const [me, cookieStore] = await Promise.all([getMe(), cookies()]);
  const theme = parseTheme(cookieStore.get(THEME_COOKIE)?.value);

  const managed = me.contexts.filter(
    (context) => context.role === "manager" && context.status === "active"
  );

  return (
    <div className="min-h-screen bg-ui-muted/60">
      <header className="sticky top-0 z-40 border-b border-ui-border bg-ui-background/85 backdrop-blur supports-[backdrop-filter]:bg-ui-background/70">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 lg:flex-nowrap">
          <Link href="/learn">
            <Logo />
          </Link>

          {/* On a phone the navigation takes its own row and scrolls sideways, so
              the wordmark and the account actions stay on one line above it. */}
          <nav
            aria-label="Main"
            className="order-last -mx-1 flex w-full items-center gap-1 overflow-x-auto px-1 pb-1 lg:order-none lg:mx-0 lg:w-auto lg:flex-1 lg:overflow-visible lg:px-0 lg:pb-0"
          >
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
            <NavLink href="/settings" current={active === "settings"} className="lg:ml-auto">
              Settings
            </NavLink>
          </nav>

          <div className="ml-auto flex items-center gap-1 lg:ml-0">
            <ThemeToggle initial={theme} />
            {/* Signing out is an action, not a destination. */}
            <form action={signOut}>
              <Button type="submit" variant="outline" size="sm">
                <LogOut aria-hidden />
                Sign out
              </Button>
            </form>
          </div>
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
      // is also what the visible highlight is keyed to — one source, not two.
      aria-current={current ? "page" : undefined}
      className={`shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-ui-muted hover:text-ui-foreground ${
        current ? "bg-ui-accent text-ui-accent-foreground" : "text-ui-muted-foreground"
      } ${className}`}
    >
      {children}
    </Link>
  );
}

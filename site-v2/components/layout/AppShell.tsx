import Link from "next/link";
import { cookies } from "next/headers";
import { getMe } from "@/features/identity/me";
import { signOut } from "@/app/(platform)/login/actions";
import { pageContainer } from "@/components/pglearn/layout";
import { Logo } from "@/components/pglearn/Logo";
import { ProfileMenu } from "@/components/pglearn/ProfileMenu";
import { THEME_COOKIE, parseTheme } from "@/components/pglearn/theme";

/*
 * The one application shell (spec/04), cut down for the PG Learn launch: the
 * wordmark on the left and the account menu (Settings, light/dark mode, Sign
 * out) on the right. Learners need nothing else — their learning is the home
 * page the wordmark links to.
 *
 * Managers alone get two shortcuts in the bar: "Learning" and their
 * organization. A manager of several organizations gets "Organizations"
 * instead, because spec/04 requires that they explicitly select one. Platform
 * admin destinations live in the account menu.
 *
 * The navigation is built from `get_me`, which returns the caller's own
 * contexts and admin flag. It is a convenience, not a control: every screen it
 * links to re-establishes the caller's rights from the database.
 */

const ADMIN_LINKS = [
  { href: "/admin/programs", label: "Programs" },
  { href: "/admin/organizations", label: "Organizations" },
  { href: "/admin/individuals", label: "Individuals" },
  { href: "/admin/reports", label: "Reports" },
  { href: "/admin/operations", label: "Operations" },
];

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
    <div className="min-h-screen bg-ui-background">
      <header className="sticky top-0 z-40 border-b border-ui-border bg-ui-card">
        <div className={`${pageContainer} flex min-h-[72px] items-center gap-4 py-3`}>
          <Link href="/learn" className="shrink-0">
            <Logo />
          </Link>

          {managed.length > 0 && (
            <nav aria-label="Main" className="ml-auto flex min-w-0 items-center gap-1 overflow-x-auto">
              <NavLink href="/learn" current={active === "learn"}>
                Learning
              </NavLink>
              {managed.length === 1 ? (
                <NavLink href={`/manage/${managed[0].organization_id}`} current={active === "manage"}>
                  {managed[0].organization_name}
                </NavLink>
              ) : (
                <NavLink href="/manage" current={active === "manage"}>
                  Organizations
                </NavLink>
              )}
            </nav>
          )}

          <div className={managed.length > 0 ? "shrink-0" : "ml-auto shrink-0"}>
            <ProfileMenu
              name={me.profile.display_name}
              email={me.profile.email}
              initialTheme={theme}
              signOut={signOut}
              adminLinks={me.platform_admin ? ADMIN_LINKS : []}
            />
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
      // PG Labs tabs: a pill that washes with `ink-4` on hover; the current
      // page is set in the heading colour on the `surface-subtle` ground.
      className={`shrink-0 whitespace-nowrap rounded-full px-4 py-2 font-ui text-ui-button transition-colors hover:bg-ui-wash hover:text-ui-foreground ${
        current ? "bg-ui-accent text-ui-accent-foreground" : "text-ui-muted-foreground"
      } ${className}`}
    >
      {children}
    </Link>
  );
}

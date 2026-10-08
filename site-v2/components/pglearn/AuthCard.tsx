import Link from "next/link";
import { Logo } from "./Logo";

/*
 * The SkillSphere sign-in frame shared by every pre-session screen (sign in,
 * password reset and set, invitations): a centred card with a primary-tinted
 * wash and a faint grid fading out from the top, the logo above the title.
 */
export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ui-muted/60 px-4 py-10 sm:px-6 sm:py-16">
      <div className="relative w-full max-w-md overflow-hidden rounded-xl bg-ui-card px-6 py-8 text-ui-card-foreground shadow-lg ring-1 ring-ui-foreground/5 sm:px-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-52 bg-gradient-to-b from-ui-primary/10 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-52 bg-[linear-gradient(to_right,oklch(var(--ui-foreground)/0.06)_1px,transparent_1px),linear-gradient(to_bottom,oklch(var(--ui-foreground)/0.06)_1px,transparent_1px)] bg-[size:20px_20px] [mask-image:linear-gradient(to_bottom,black,transparent)]"
        />
        <div className="relative">
          <Link href="/learn" className="mb-6 flex justify-center">
            <Logo />
          </Link>
          {children}
        </div>
      </div>
    </main>
  );
}

import Link from "next/link";
import { Logo } from "./Logo";
import { Eyebrow } from "./Eyebrow";

/*
 * The frame shared by every pre-session screen (sign in, password reset and
 * set, invitations): a `surface` card on the `surface-subtle` canvas,
 * `radius-m`, a hairline and no shadow, with the PG Labs lockup and a
 * "PGLearn" eyebrow above the page's own title.
 */
export function AuthCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-ui-background px-6 py-12">
      <div className="w-full max-w-md rounded-ui border border-ui-border bg-ui-card px-6 py-9 text-ui-card-foreground sm:px-9">
        <Link href="/learn" className="mb-9 flex justify-center">
          <Logo />
        </Link>
        <Eyebrow className="mb-3 justify-center">PGLearn</Eyebrow>
        {children}
      </div>
    </main>
  );
}

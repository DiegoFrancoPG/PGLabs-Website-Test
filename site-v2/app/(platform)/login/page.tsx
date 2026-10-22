import type { Metadata } from "next";
import Image from "next/image";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { LoginForm } from "./login-form";
import { Logo } from "@/components/pglearn/Logo";
import { Eyebrow } from "@/components/pglearn/Eyebrow";

export const metadata: Metadata = { title: "Sign in" };

/*
 * PG Learn launches on its own, so sign-in is also its home page: the one
 * screen a visitor sees before anything else. It follows the PG Labs design
 * system's split of grounds — a `surface-dark` panel carrying the product's
 * promise in Lora (a photo under `overlay-40`, text in `text-light` and the
 * `white-*` steps, `accent` only as the eyebrow rule and 6px bullets) beside
 * the sign-in form on `surface`.
 *
 * The dark panel nests its own `.pglearn.dark` scope, so it reads the
 * dark-section tokens whatever mode the visitor chose for the app.
 */

const promises = [
  "Short video lessons built for nonprofit teams.",
  "Learn at your own pace, and pick up where you left off.",
  "A certificate when you complete a program.",
];

export default async function LoginPage() {
  // An already-signed-in visitor has no business on the sign-in form.
  if (await verifiedUser()) redirect("/learn");

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section
        aria-labelledby="home-title"
        className="pglearn dark relative isolate flex flex-col justify-between gap-12 overflow-hidden bg-ui-background px-6 py-9 sm:px-12 lg:px-16 lg:py-12"
      >
        <Image
          src="/images/figma-2026/team-collaborating-1.jpg"
          alt=""
          fill
          priority
          sizes="(min-width: 1024px) 55vw, 100vw"
          className="-z-20 object-cover"
        />
        {/* overlay-40, then a fall to surface-dark so the type always sits on ink. */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-t from-[rgb(16_22_31)] via-[rgb(16_22_31/0.75)] to-[rgb(16_22_31/0.4)]"
        />

        <Logo />

        <div className="max-w-xl">
          <Eyebrow className="text-white/70">PG Learn</Eyebrow>
          <h1
            id="home-title"
            className="mt-3 font-heading text-[34px] leading-[38px] tracking-[-0.8px] text-ui-foreground sm:text-ui-section lg:text-ui-display"
          >
            Learning for responsible technology in the social sector
          </h1>
          <p className="mt-5 text-ui-lead text-white/70">
            Practical programs from PG Labs, a PeaceGeeks initiative, for nonprofit leaders and
            staff working with AI and technology.
          </p>
          <ul className="mt-8 flex flex-col gap-3">
            {promises.map((promise) => (
              <li key={promise} className="flex items-baseline gap-3 text-ui-body text-white/70">
                <span aria-hidden className="size-1.5 shrink-0 translate-y-[-2px] rounded-full bg-ui-brand" />
                {promise}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-ui-caption text-white/60">© PG Labs · A PeaceGeeks initiative</p>
      </section>

      <main className="flex items-center justify-center bg-ui-card px-6 py-12 sm:px-12">
        <div className="w-full max-w-md">
          <Eyebrow className="mb-3">Welcome</Eyebrow>
          <h2 className="font-heading text-ui-title text-ui-foreground">Sign in to PG Learn</h2>
          <p className="mt-2 text-ui-body text-ui-muted-foreground">
            Accounts are created by invitation. If you have not been invited yet, ask your
            organization&rsquo;s manager.
          </p>
          <LoginForm />
        </div>
      </main>
    </div>
  );
}

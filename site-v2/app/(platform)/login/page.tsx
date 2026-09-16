import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  // An already-signed-in visitor has no business on the sign-in form.
  if (await verifiedUser()) redirect("/learn");

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <h1 className="font-display text-h2-sm text-ink-800">Sign in to PGLearn</h1>
      <p className="mt-3 text-body-sm text-steel-500">
        PGLearn accounts are created by invitation. If you have not been invited yet, ask your
        organization&rsquo;s manager.
      </p>
      <LoginForm />
      <p className="mt-8 text-body-sm">
        <Link href="/learning" className="text-brand-600 underline underline-offset-4">
          What is PGLearn?
        </Link>
      </p>
    </main>
  );
}

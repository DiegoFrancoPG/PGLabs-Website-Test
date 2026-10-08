import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { LoginForm } from "./login-form";
import { AuthCard } from "@/components/pglearn/AuthCard";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  // An already-signed-in visitor has no business on the sign-in form.
  if (await verifiedUser()) redirect("/learn");

  return (
    <AuthCard>
      <h1 className="text-center font-heading text-2xl font-semibold tracking-tight text-ui-foreground">Sign in to PGLearn</h1>
      <p className="mt-2 text-center text-sm text-ui-muted-foreground">
        PGLearn accounts are created by invitation. If you have not been invited yet, ask your
        organization&rsquo;s manager.
      </p>
      <LoginForm />
      <p className="mt-6 text-center text-sm">
        <Link href="/learning" className="pglearn-link">
          What is PGLearn?
        </Link>
      </p>
    </AuthCard>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-form";
import { AuthCard } from "@/components/pglearn/AuthCard";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard>
      <h1 className="text-center font-heading text-2xl font-semibold tracking-tight text-ui-foreground">Reset your password</h1>
      <p className="mt-2 text-center text-sm text-ui-muted-foreground">
        Enter the email address you use for PGLearn and we will send you a link.
      </p>
      <ForgotPasswordForm />
      <p className="mt-6 text-center text-sm">
        <Link href="/login" className="pglearn-link">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}

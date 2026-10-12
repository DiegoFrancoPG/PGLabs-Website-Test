import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-form";
import { AuthCard } from "@/components/pglearn/AuthCard";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <AuthCard>
      <h1 className="text-center font-heading text-ui-title text-ui-foreground">Reset your password</h1>
      <p className="mt-2 text-center text-ui-body text-ui-muted-foreground">
        Enter the email address you use for PGLearn and we will send you a link.
      </p>
      <ForgotPasswordForm />
      <p className="mt-6 text-center text-ui-body">
        <Link href="/login" className="pglearn-link">
          Back to sign in
        </Link>
      </p>
    </AuthCard>
  );
}

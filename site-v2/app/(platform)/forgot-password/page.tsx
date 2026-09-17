import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "./forgot-form";

export const metadata: Metadata = { title: "Reset your password" };

export default function ForgotPasswordPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <h1 className="font-display text-h2-sm text-ink-800">Reset your password</h1>
      <p className="mt-3 text-body-sm text-steel-500">
        Enter the email address you use for PGLearn and we will send you a link.
      </p>
      <ForgotPasswordForm />
      <p className="mt-8 text-body-sm">
        <Link href="/login" className="text-brand-600 underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}

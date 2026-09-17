import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { SetPasswordForm } from "./set-password-form";

export const metadata: Metadata = { title: "Choose a password" };

export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  /*
   * Reached only with a session established by the recovery or invitation link,
   * so an anonymous visitor is sent to sign in rather than shown the form.
   */
  if (!(await verifiedUser())) redirect("/login?link=invalid");
  const { next } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-6 py-16">
      <h1 className="font-display text-h2-sm text-ink-800">Choose a password</h1>
      <p className="mt-3 text-body-sm text-steel-500">
        Use at least 12 characters. A short phrase you will remember works better than a short word.
      </p>
      <SetPasswordForm next={next ?? ""} />
    </main>
  );
}

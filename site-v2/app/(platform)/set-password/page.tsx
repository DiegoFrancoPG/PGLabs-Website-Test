import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { verifiedUser } from "@/lib/auth";
import { SetPasswordForm } from "./set-password-form";
import { AuthCard } from "@/components/pglearn/AuthCard";

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
    <AuthCard>
      <h1 className="text-center font-heading text-2xl font-semibold tracking-tight text-ui-foreground">Choose a password</h1>
      <p className="mt-2 text-center text-sm text-ui-muted-foreground">
        Use at least 12 characters. A short phrase you will remember works better than a short word.
      </p>
      <SetPasswordForm next={next ?? ""} />
    </AuthCard>
  );
}

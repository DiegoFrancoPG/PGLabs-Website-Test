"use server";

import { userClient } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";

/*
 * spec/04 /forgot-password: "Always generic sent response; rate-limit countdown
 * without revealing account existence."
 * spec/03: "Password-reset request always returns a generic success message,
 * regardless of email existence. Do not expose account lookup to
 * unauthenticated callers."
 *
 * So this returns the same result whether or not the address exists, including
 * when the provider itself fails. An error here would otherwise be a lookup
 * oracle: "something went wrong" for known addresses and success for unknown
 * ones would leak exactly what the rule protects.
 */
export async function requestReset(_state: { sent: boolean }, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email) return { sent: false, error: "Enter your email address." };

  const supabase = await userClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${serverEnv().NEXT_PUBLIC_APP_URL}/auth/callback?next=/set-password`,
  });
  if (error) {
    // Logged, never surfaced. The caller sees the same response either way.
    console.error("[forgot-password] provider error", { code: error.code });
  }
  return { sent: true };
}

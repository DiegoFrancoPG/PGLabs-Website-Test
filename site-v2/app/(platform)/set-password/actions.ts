"use server";

import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase/server";

/*
 * spec/04 /set-password: "Password + confirm, 12–128 chars. Match/length
 * errors; server Auth failure preserves input only in component memory."
 *
 * spec/03 orders this precisely: "Only after a successful Auth password update
 * and matching unexpired invitation acceptance set onboarded_at". The password
 * is updated first; acceptance is a separate, explicit step afterwards.
 */
export interface SetPasswordState {
  error?: string;
  fieldErrors?: Record<string, string>;
}

const MIN = 12;
const MAX = 128;

export async function setPassword(
  _state: SetPasswordState,
  formData: FormData
): Promise<SetPasswordState> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  const next = String(formData.get("next") ?? "");

  const fieldErrors: Record<string, string> = {};
  // Counted in code points, so a passphrase using non-ASCII characters is not
  // penalised for the bytes it happens to occupy.
  const length = [...password].length;
  if (length < MIN || length > MAX) {
    fieldErrors.password = `Choose a password between ${MIN} and ${MAX} characters.`;
  }
  if (password !== confirm) {
    fieldErrors.confirm = "The two passwords do not match.";
  }
  if (Object.keys(fieldErrors).length > 0) {
    return { error: "Check the highlighted fields.", fieldErrors };
  }

  const supabase = await userClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    // The recovery link has expired or was already used.
    return { error: "That link is no longer valid. Request a new one." };
  }

  const { error: updateError } = await supabase.auth.updateUser({ password });
  if (updateError) {
    console.error("[set-password] update failed", { code: updateError.code });
    return { error: "Your password could not be set. Try again." };
  }

  // Only same-site paths, so this cannot be turned into an open redirect.
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/learn");
}

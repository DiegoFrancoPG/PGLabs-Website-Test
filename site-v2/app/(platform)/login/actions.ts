"use server";

import { redirect } from "next/navigation";
import { userClient } from "@/lib/supabase/server";

/*
 * spec/04 /login: "Generic credentials error, submit disabled while pending;
 * success goes to /learn."
 *
 * The error is deliberately identical for an unknown email and a wrong
 * password. Distinguishing them would turn the form into an account-existence
 * oracle, which spec/03 forbids for password reset and which applies just as
 * much here.
 */
export async function signIn(_state: { error?: string }, formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email address and password." };
  }

  const supabase = await userClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("[login] failed", { code: error.code });
    return { error: "That email address and password do not match." };
  }
  redirect("/learn");
}

export async function signOut() {
  const supabase = await userClient();
  await supabase.auth.signOut();
  redirect("/login");
}

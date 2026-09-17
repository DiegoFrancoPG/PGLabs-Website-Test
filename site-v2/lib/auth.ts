import { userClient } from "@/lib/supabase/server";

/*
 * Session verification.
 *
 * ADR-05: "Login session is verified server-side using Supabase getUser() for
 * protected requests." getUser() revalidates the token with the Auth server;
 * getSession() only decodes the cookie, which a client can edit. Nothing in
 * this codebase may use getSession() to decide authority.
 */

export interface VerifiedUser {
  id: string;
  email: string | null;
}

/** The verified user, or null. Never throws for an anonymous caller. */
export async function verifiedUser(): Promise<VerifiedUser | null> {
  const supabase = await userClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;
  return { id: data.user.id, email: data.user.email ?? null };
}

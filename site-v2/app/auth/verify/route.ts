import { NextResponse, type NextRequest } from "next/server";
import { userClient } from "@/lib/supabase/server";
import { CONFIRM_TYPES, safeNext } from "@/lib/auth-links";

/*
 * Exchanges an emailed one-time token for a session (D-27), when the person
 * presses Continue on /auth/confirm. Like /auth/callback, the token is never
 * echoed into a redirect or a log line, and only same-site paths are followed.
 *
 * 303, so the browser follows with a GET.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData();
  const tokenHash = String(form.get("token_hash") ?? "");
  const type = String(form.get("type") ?? "");
  const next = safeNext(String(form.get("next") ?? ""));

  if (!tokenHash || !CONFIRM_TYPES.includes(type as (typeof CONFIRM_TYPES)[number])) {
    return NextResponse.redirect(new URL("/login?link=invalid", request.url), 303);
  }

  const supabase = await userClient();
  const { error } = await supabase.auth.verifyOtp({
    token_hash: tokenHash,
    type: type as (typeof CONFIRM_TYPES)[number],
  });
  if (error) {
    console.error("[auth/verify] verification failed", { code: error.code });
    return NextResponse.redirect(new URL("/login?link=invalid", request.url), 303);
  }
  return NextResponse.redirect(new URL(next, request.url), 303);
}

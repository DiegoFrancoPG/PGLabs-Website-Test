import { NextResponse, type NextRequest } from "next/server";
import { userClient } from "@/lib/supabase/server";

/*
 * spec/04 /auth/callback: "Verify token/code; invalid/expired link page with
 * recovery action; never render tokens."
 *
 * The code is exchanged and then dropped. It is never echoed into the page,
 * the redirect target or a log line.
 */
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const next = request.nextUrl.searchParams.get("next");

  // Only same-site paths, so the callback cannot be used as an open redirect.
  const destination = next && next.startsWith("/") && !next.startsWith("//") ? next : "/learn";

  if (!code) {
    return NextResponse.redirect(new URL("/login?link=invalid", request.url));
  }

  const supabase = await userClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    console.error("[auth/callback] exchange failed", { code: error.code });
    return NextResponse.redirect(new URL("/login?link=invalid", request.url));
  }
  return NextResponse.redirect(new URL(destination, request.url));
}

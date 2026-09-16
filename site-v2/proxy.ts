import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/*
 * Next 16 renamed this convention from `middleware` to `proxy`; the behaviour
 * and the matcher are unchanged.
 *
 * Two jobs, both security-relevant, and only on platform paths — the marketing
 * site never reaches this file, so it stays statically served.
 *
 * 1. Refresh the Supabase session so server components see a current token.
 * 2. Reject cross-origin mutations.
 *
 * spec/05: "Check Origin equals configured app origin on cookie-authenticated
 * mutations; reject absent/foreign Origin except a documented trusted server
 * call using the same service directly."
 */

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/*
 * Routes that authenticate by something other than the session cookie, so the
 * Origin rule does not apply to them:
 *   /api/v1/webhooks/*  verified by svix signature over the raw body (spec/05)
 *   /api/v1/jobs/*      verified by the CRON_SECRET bearer token (spec/05)
 * Neither is reachable with a stolen cookie, which is what the Origin check
 * defends against.
 */
const NON_COOKIE_AUTH = /^\/api\/v1\/(webhooks|jobs)\//;

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (MUTATING.has(request.method) && !NON_COOKIE_AUTH.test(pathname)) {
    const origin = request.headers.get("origin");
    const expected = process.env.NEXT_PUBLIC_APP_URL;
    /*
     * An absent Origin is rejected too, not just a foreign one: browsers send
     * it on every cross-origin mutation, so a missing header on a
     * cookie-authenticated write is not something to give the benefit of the
     * doubt to.
     */
    if (!origin || !expected || origin !== new URL(expected).origin) {
      return NextResponse.json(
        {
          error: { code: "FORBIDDEN", message: "Cross-origin request rejected.", fields: [] },
          request_id: crypto.randomUUID(),
        },
        { status: 403, headers: { "Cache-Control": "private, no-store" } }
      );
    }
  }

  // Refresh the session and carry any rotated cookies onto the response.
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
        },
      },
    }
  );
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    "/login",
    "/forgot-password",
    "/set-password",
    "/invitations/:path*",
    "/auth/:path*",
    "/learn/:path*",
    "/certificates/:path*",
    "/settings",
    "/manage/:path*",
    "/admin/:path*",
    "/api/v1/:path*",
  ],
};

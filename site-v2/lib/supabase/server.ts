import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

/*
 * Supabase clients for server code. Two of them, with very different authority.
 *
 * Follows the official SSR guidance spec/05 points at:
 * https://supabase.com/docs/guides/auth/server-side/creating-a-client
 */

/**
 * The user-scoped client. Every query it makes runs as the signed-in user, so
 * `auth.uid()` inside pglearn_rpc is that user. This is what normal requests
 * use — spec/02: "Normal application queries use the user-scoped Supabase
 * client to call pglearn_rpc."
 */
export async function userClient() {
  const env = serverEnv();
  const store = await cookies();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component, where cookies are read-only. The
          // middleware refreshes the session, so this is safe to ignore.
        }
      },
    },
  });
}

/**
 * The service client. Bypasses RLS completely, so it is confined to Auth admin
 * work, signed storage URLs, jobs and provider-result persistence (spec/02).
 *
 * It takes no cookies on purpose: there is no user attached to it, and nothing
 * it does may be driven by a browser-supplied identity.
 */
export function serviceClient() {
  const env = serverEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

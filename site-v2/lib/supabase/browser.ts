"use client";

import { createBrowserClient } from "@supabase/ssr";

/*
 * The browser client. It only ever receives the publishable key — the service
 * key must never reach a bundle, which tests/unit assert.
 */
export function browserClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!
  );
}

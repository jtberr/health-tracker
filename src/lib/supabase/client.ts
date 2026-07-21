"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

/**
 * Browser-side Supabase client (RLS-scoped anon key only — never the service-role key).
 *
 * Web Forms analogy: this is the client-side equivalent of a page making an AJAX call back to
 * itself — except here it talks straight to Supabase's API, with the anon key + RLS policies
 * doing the authorization Web Forms would otherwise leave to server-side code-behind.
 *
 * `persistSession` + `autoRefreshToken` implement the project's "persistent login" decision
 * (ai-context/DECISIONS.md): a user stays logged in on a device indefinitely until they
 * explicitly log out — no app-imposed session timeout. Supabase's own long-lived, rotating
 * refresh tokens do the rest; `middleware.ts` keeps the cookie-based session fresh on navigation.
 */
export function createClient() {
  const { url, anonKey } = getSupabaseEnv();

  return createBrowserClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
  });
}

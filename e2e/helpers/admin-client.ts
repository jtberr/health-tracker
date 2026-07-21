import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for test/CI setup ONLY.
 *
 * Per AGENTS.md's Absolute Rules, the service-role key (which bypasses Row Level Security
 * entirely) must never be shipped to the browser or used outside trusted server-only contexts.
 * This file lives under `e2e/`, outside `src/`, specifically so it can never be imported by
 * anything that ends up in the Next.js app bundle — it is only ever run by the Playwright test
 * runner (Node, server-side, against a local or CI-only Supabase instance).
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "e2e admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY " +
        "(see .env.example). Run `npx supabase start` locally and copy its printed values.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

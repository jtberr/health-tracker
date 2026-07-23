import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { TestUser } from "./test-users";

/**
 * Anon-key Supabase client signed in as a given test user — the exact RLS-scoped client shape
 * the real app uses (never service-role). Used by DB-level integration tests to exercise RLS
 * policies "as each user's JWT", per docs/architecture/food-weight-tracker.md §6/§8 Phase 2.
 */
export async function createUserClient(user: TestUser): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "DB integration tests require NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY " +
        "(see .env.example). Run `npx supabase start` locally and copy its printed values.",
    );
  }

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error } = await client.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  if (error) {
    throw new Error(`Failed to sign in test user ${user.email}: ${error.message}`);
  }

  return client;
}

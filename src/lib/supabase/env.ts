/**
 * Central place that reads + validates the Supabase env vars every client factory needs.
 * Throws early (at first client construction) with a clear message instead of letting the
 * Supabase SDK fail later with an opaque "Invalid URL" error.
 */
export function getSupabaseEnv(): { url: string; anonKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
        "Copy .env.example to .env.local and fill in your local `supabase start` output " +
        "(or your hosted Supabase project's API settings).",
    );
  }

  return { url, anonKey };
}

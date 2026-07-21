import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

/**
 * Server-side Supabase client, bound to the incoming request's cookies (Next.js `cookies()`).
 *
 * Web Forms analogy: this is the closest thing to `HttpContext.Current.Session`/`Request.Cookies`
 * in a code-behind handler — it reads the signed-in user's session from the request and every
 * query it makes is scoped by Postgres Row Level Security to `auth.uid()` for that user. There is
 * no separate "data access layer" step where you'd hand-check `user_id` — RLS does it in the DB.
 *
 * Must be created fresh per request (never module-level/singleton) because it closes over that
 * request's cookies.
 *
 * `setAll` can be called from a Server Component render, where Next.js disallows writing cookies
 * (only Server Actions and Route Handlers may). We swallow that specific case — the session is
 * still current for this request; `middleware.ts` is what keeps the cookie itself refreshed on
 * navigation, so a Server Component not being able to write a refreshed cookie is harmless here.
 */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, anonKey } = getSupabaseEnv();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component — no-op; middleware.ts refreshes the session cookie
          // on navigation, and Server Actions / Route Handlers can still write cookies directly.
        }
      },
    },
  });
}

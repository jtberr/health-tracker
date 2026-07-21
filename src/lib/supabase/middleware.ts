import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv } from "./env";

/**
 * Refreshes the Supabase session cookie on every navigation, per the project's persistent-login
 * decision (ai-context/DECISIONS.md): Supabase's refresh tokens rotate, so the cookie needs to be
 * rewritten on the response whenever a refresh happens, or the *next* request would present a
 * stale token. This does not gate access to any route — it only keeps a valid session alive.
 * Route-level auth gating lives in `(app)/layout.tsx` (redirect-to-/login on no session).
 *
 * Web Forms analogy: closest to `Global.asax`'s `Application_AuthenticateRequest` — runs on every
 * request, silently keeps the auth ticket current, but doesn't itself decide who's allowed where.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const { url, anonKey } = getSupabaseEnv();

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  // Calling getUser() (not getSession()) is what actually triggers the refresh-if-needed check
  // against Supabase's servers, and is what writes a refreshed token back via setAll above.
  await supabase.auth.getUser();

  return response;
}

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Supabase auth code-exchange callback. Supabase's signup-confirmation email and any future
 * magic-link/OAuth flow redirect the browser here with a `?code=...` query param; we exchange
 * it server-side for a session (which writes the session cookie via the server client), then
 * send the user on to the app.
 *
 * Web Forms analogy: like a `Login.aspx` postback target you never render UI for — it just
 * validates a token, sets the auth cookie, and redirects (`Response.Redirect`).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Missing/invalid code, or the exchange failed (e.g. expired confirmation link) — send the
  // user to login with an explanatory flag rather than silently landing them in the app.
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}

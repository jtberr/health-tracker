import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";

/**
 * Single auth gate for every authenticated route (per the design doc §3.1: "layout.tsx ←
 * server-side session check → redirect /login if none; nav; signOut action").
 *
 * Web Forms analogy: this is the one place doing what a shared master page's
 * `Page_Load` + `if (!User.Identity.IsAuthenticated) Response.Redirect("Login.aspx")` would have
 * done — except every route under `(app)/` automatically inherits it via the layout, so no
 * individual page has to remember to check.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-full flex-1 flex-col">
      <header className="border-b border-zinc-200 bg-white">
        <nav className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-semibold text-zinc-900">
            Health Tracker
          </Link>
          <div className="flex items-center gap-4 text-sm text-zinc-600">
            <Link href="/food" className="font-medium text-zinc-700 hover:text-zinc-900">
              Food
            </Link>
            <span className="hidden sm:inline">{user.email}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Log out
              </button>
            </form>
          </div>
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-8">{children}</main>
    </div>
  );
}

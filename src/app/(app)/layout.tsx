import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/lib/actions/auth";
import { Button } from "@/components/ui/Button";
import { NavLink } from "@/components/ui/NavLink";

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
      <header className="border-b border-stone-200 bg-white/80 backdrop-blur-sm">
        <nav className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link href="/" className="font-serif text-base font-semibold tracking-tight text-ink">
            Health Tracker
          </Link>
          <div className="flex items-center gap-1 text-sm sm:gap-2">
            <NavLink href="/food">Food</NavLink>
            <NavLink href="/metrics">Weight</NavLink>
            <NavLink href="/trends">Trends</NavLink>
            <NavLink href="/settings">Settings</NavLink>
          </div>
          <div className="flex items-center gap-3 text-sm text-stone-500">
            <span className="hidden sm:inline">{user.email}</span>
            <form action={signOut}>
              <Button type="submit" variant="secondary" size="sm">
                Log out
              </Button>
            </form>
          </div>
        </nav>
      </header>
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col px-4 py-8">{children}</main>
    </div>
  );
}

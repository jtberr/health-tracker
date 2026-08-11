import { redirect } from "next/navigation";

/**
 * The dashboard route is retired, not rebuilt (Phase 8h,
 * docs/architecture/food-weight-tracker.md §3.4/§4). Every candidate for a dashboard either
 * already existed one click away (`DailyTotals` on `/food`, the charts on `/trends`) or belongs
 * on the screen it is actually about (last-logged weight/body fat now lives on `/metrics`) — so
 * the page itself was a literal duplicate of `/food`'s totals behind an extra click, in an app
 * whose first-stated priority is that logging must be fast.
 *
 * The `/` route is deliberately KEPT (not deleted, not repointed elsewhere) so the auth callback,
 * the sign-in redirect, and the header wordmark (`(app)/layout.tsx`'s `<Link href="/">`) all keep
 * working completely untouched — this is a one-line redirect, not a routing refactor.
 */
export default function DashboardPage() {
  redirect("/food");
}

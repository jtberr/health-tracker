/**
 * Shared timeout wiring for browser-side Supabase reads (`TodaySummary`, `FoodDayView`,
 * `MetricForm` — see each component's doc comment for why those reads happen client-side at all).
 *
 * Those reads already handle a query that *settles* with an error (HTTP 500, RLS rejection, a
 * malformed filter, etc.) via their existing try/catch + `error` check, surfacing a "Couldn't
 * load..." message with a Retry button. What they didn't handle is a request that never settles
 * at all — a wedged connection, a proxy that swallows the request, no response ever arriving —
 * which left the UI stuck on "Loading…" forever with no feedback (the real-world symptom this
 * module fixes; see `ai-context/PROGRESS.md`'s "no client-fetch timeout" follow-up).
 *
 * Wiring `queryTimeoutSignal()` into a query via Supabase's `.abortSignal(signal)` query-builder
 * method (supported on every `postgrest-js` filter/transform builder) makes a hung request abort
 * after a bounded wait. Per `postgrest-js`'s own behavior, an aborted request resolves the query
 * with `{ data: null, error: {...} }` rather than throwing (unless `.throwOnError()` was called,
 * which nothing in this codebase does) — so no new error-handling path is needed at call sites:
 * the existing `if (error) { setError(true) }` / try/catch already covers it.
 */

/** How long a browser-side Supabase read is allowed to hang before it's aborted. */
export const QUERY_TIMEOUT_MS = 12_000;

/**
 * Returns a fresh `AbortSignal` that self-aborts after `ms` (default `QUERY_TIMEOUT_MS`). A thin
 * wrapper around the platform `AbortSignal.timeout()` (supported in all evergreen browsers and
 * Node 18+, and the exact pattern Supabase's own `abortSignal()` doc comment recommends for a
 * timeout) so call sites share one timeout value instead of each hardcoding it.
 */
export function queryTimeoutSignal(ms: number = QUERY_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(ms);
}

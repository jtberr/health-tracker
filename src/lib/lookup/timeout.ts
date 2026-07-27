/**
 * Shared timeout wiring for the food-lookup network calls (Phase 6 — barcode + description
 * search), on both the server adapters (`openfoodfacts.ts`, `usda.ts`) and the browser-side
 * `FoodLookupPanel` fetches to this app's own `/api/lookup/*` proxy.
 *
 * qa-reviewer N-1: neither the adapters nor the panel previously set any fetch timeout, so a hung
 * outbound request (or a hung request to our own proxy) left the panel on "Looking up…" forever
 * with no feedback. This mirrors the exact same problem (and fix shape) already solved for
 * browser-side Supabase reads in `lib/supabase/query-timeout.ts` — a thin wrapper around the
 * platform `AbortSignal.timeout()`, which works identically in both a server Route Handler/adapter
 * and a browser Client Component, so one helper covers both call sites.
 */

/** How long any single food-lookup network call is allowed to hang before it's aborted. */
export const LOOKUP_TIMEOUT_MS = 10_000;

/**
 * Returns a fresh `AbortSignal` that self-aborts after `ms` (default `LOOKUP_TIMEOUT_MS`). Pass it
 * as `{ signal }` to `fetch()` — an aborted fetch rejects with an `AbortError`/`TypeError`, which
 * every call site here already treats as an ordinary transport failure (the existing `catch`
 * blocks in `openfoodfacts.ts`/`usda.ts` return `{ ok: false }`, and `FoodLookupPanel`'s existing
 * `catch` already surfaces the same "unavailable right now — enter the food manually" fallback) —
 * no new error-handling path is needed at any call site.
 */
export function lookupTimeoutSignal(ms: number = LOOKUP_TIMEOUT_MS): AbortSignal {
  return AbortSignal.timeout(ms);
}

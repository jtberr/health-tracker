/**
 * Server-only adapter for Open Food Facts' public barcode-lookup API (free, keyless — see
 * ai-context/DECISIONS.md "Food lookup: Open Food Facts (barcode) + USDA FoodData Central
 * (search), via a server-side proxy"). Fetches and loosely parses the raw JSON envelope; turning
 * the raw `product` object into the app's `FoodCandidate` shape happens separately in
 * `lib/domain/lookup.ts` (framework-free, unit-testable without network access).
 *
 * Never call this from a client component — it must only ever be invoked from
 * `app/api/lookup/barcode/route.ts`, an auth-gated Route Handler, per AGENTS.md's "What Not To
 * Do" (third-party lookups always go through a server-side proxy so nothing besides the barcode
 * itself ever leaves the system).
 */

import { lookupTimeoutSignal } from "./timeout";

// qa-reviewer N-3: reads from an env var (falling back to the real default) so a test suite/CI
// can redirect this to a local mock server -- there was previously no seam to intercept the
// outbound call short of stubbing global `fetch`. Not wired into `.github/workflows/ci.yml` by
// this change (that file is architect-owned); this only makes the seam exist.
const OPEN_FOOD_FACTS_BASE_URL =
  process.env.OPEN_FOOD_FACTS_BASE_URL ?? "https://world.openfoodfacts.org/api/v2/product";

export type OpenFoodFactsLookupResult =
  | { ok: true; found: true; product: unknown }
  | { ok: true; found: false }
  | { ok: false };

/**
 * Looks up a single barcode. Only the barcode digits are ever sent to Open Food Facts — no user
 * identity, per AGENTS.md's Absolute Rules. Distinguishes "not found" (`status !== 1` in Open
 * Food Facts' own response envelope) from a genuine transport/provider failure so the caller can
 * surface the right message (manual-entry fallback vs. "lookup unavailable").
 *
 * Confirmed against the live v2 API (2026-07-29): an unknown barcode comes back as HTTP 404 with
 * a normal JSON body (`{status: 0, status_verbose: "product not found"}`), not HTTP 200 as
 * earlier testing had assumed — 404 is Open Food Facts' genuine "not found" response, not a
 * provider failure, so it must still be parsed rather than short-circuited by `!response.ok`.
 * Anything else non-ok (5xx, etc.) is treated as a real transport/provider failure.
 */
export async function fetchOpenFoodFactsProduct(barcode: string): Promise<OpenFoodFactsLookupResult> {
  try {
    const response = await fetch(`${OPEN_FOOD_FACTS_BASE_URL}/${encodeURIComponent(barcode)}.json`, {
      headers: { "User-Agent": "health-tracker (server-side lookup proxy)" },
      cache: "no-store",
      signal: lookupTimeoutSignal(),
    });

    if (!response.ok && response.status !== 404) {
      return { ok: false };
    }

    let body: { status?: unknown; product?: unknown };
    try {
      body = (await response.json()) as { status?: unknown; product?: unknown };
    } catch {
      return { ok: false };
    }

    if (body.status !== 1 || !body.product) {
      return { ok: true, found: false };
    }

    return { ok: true, found: true, product: body.product };
  } catch {
    return { ok: false };
  }
}

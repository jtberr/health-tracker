/**
 * Server-only adapter for USDA FoodData Central's description-search API (free tier, requires a
 * server-only API key — see ai-context/DECISIONS.md "Food lookup: Open Food Facts (barcode) +
 * USDA FoodData Central (search), via a server-side proxy"). Fetches and loosely parses the raw
 * JSON envelope; turning each raw `foods[]` entry into the app's `FoodCandidate` shape happens
 * separately in `lib/domain/lookup.ts` (framework-free, unit-testable without network access).
 *
 * Never call this from a client component — it must only ever be invoked from
 * `app/api/lookup/search/route.ts`, an auth-gated Route Handler. The API key is passed in by the
 * caller (read from `process.env.USDA_FDC_API_KEY` server-side only) and is never echoed back in
 * any response.
 */

import { lookupTimeoutSignal } from "./timeout";

// qa-reviewer N-3: reads from an env var (falling back to the real default) so a test suite/CI
// can redirect this to a local mock server -- see the matching note in openfoodfacts.ts.
const USDA_SEARCH_URL = process.env.USDA_SEARCH_URL ?? "https://api.nal.usda.gov/fdc/v1/foods/search";

export type UsdaSearchLookupResult = { ok: true; foods: unknown[] } | { ok: false };

/**
 * Searches USDA FoodData Central by free-text description. Only the search query text is ever
 * sent — no user identity, per AGENTS.md's Absolute Rules.
 */
export async function searchUsdaFoods(query: string, apiKey: string): Promise<UsdaSearchLookupResult> {
  try {
    const url = new URL(USDA_SEARCH_URL);
    url.searchParams.set("query", query);
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("pageSize", "10");

    const response = await fetch(url.toString(), { cache: "no-store", signal: lookupTimeoutSignal() });
    if (!response.ok) {
      return { ok: false };
    }

    const body = (await response.json()) as { foods?: unknown };
    return { ok: true, foods: Array.isArray(body.foods) ? body.foods : [] };
  } catch {
    return { ok: false };
  }
}

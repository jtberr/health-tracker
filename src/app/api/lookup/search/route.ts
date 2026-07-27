import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { searchUsdaFoods } from "@/lib/lookup/usda";
import { normalizeUsdaFood, type FoodCandidate } from "@/lib/domain/lookup";
import { isWithinLookupRateLimit } from "@/lib/lookup/rate-limit";

/**
 * Auth-gated, read-only proxy to USDA FoodData Central (description search) — see
 * docs/architecture/food-weight-tracker.md §8 Phase 6. `USDA_FDC_API_KEY` is read server-side
 * only, right here, and is never echoed back in any response or reachable from a client bundle.
 *
 * `GET /api/lookup/search?query=<free text>`
 * - 401 `{ error: "unauthenticated" }` if there's no session — checked BEFORE calling USDA.
 * - 429 `{ error: "rate_limited" }` if this user has exceeded the per-user rate limit (qa-reviewer
 *   N-7 — protects the shared USDA quota from a single runaway user; see
 *   `lib/lookup/rate-limit.ts`) — checked before validating/calling USDA.
 * - 400 `{ error: "invalid_query" }` if `query` is missing/blank.
 * - 502 `{ error: "provider_error" }` if the API key isn't configured, or USDA itself can't be
 *   reached / errors.
 * - 200 `{ candidates: FoodCandidate[] }` — candidates with no usable nutrition data are already
 *   dropped by `normalizeUsdaFood` and never appear in this list.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  if (!isWithinLookupRateLimit(user.id)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const { searchParams } = new URL(request.url);
  const query = (searchParams.get("query") ?? "").trim();
  if (!query) {
    return NextResponse.json({ error: "invalid_query" }, { status: 400 });
  }

  const apiKey = process.env.USDA_FDC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "provider_error" }, { status: 502 });
  }

  const result = await searchUsdaFoods(query, apiKey);
  if (!result.ok) {
    return NextResponse.json({ error: "provider_error" }, { status: 502 });
  }

  const candidates = result.foods
    .map((food) => normalizeUsdaFood(food))
    .filter((candidate): candidate is FoodCandidate => candidate !== null);

  return NextResponse.json({ candidates });
}

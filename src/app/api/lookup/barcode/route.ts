import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchOpenFoodFactsProduct } from "@/lib/lookup/openfoodfacts";
import { normalizeOpenFoodFactsProduct } from "@/lib/domain/lookup";

/** A loose UPC/EAN sanity check (6-14 digits covers EAN-8 through the longest common GTIN). */
const BARCODE_PATTERN = /^\d{6,14}$/;

/**
 * Auth-gated, read-only proxy to Open Food Facts (barcode lookup) — see
 * docs/architecture/food-weight-tracker.md §8 Phase 6 and AGENTS.md's Absolute Rules /
 * "What Not To Do": third-party food-lookup calls never happen directly from a client component,
 * and nothing beyond the barcode itself (no user identity) is ever sent to the provider.
 *
 * `GET /api/lookup/barcode?barcode=<digits>`
 * - 401 `{ error: "unauthenticated" }` if there's no session — checked BEFORE calling the
 *   external provider, so an unauthenticated caller never triggers an outbound request at all.
 * - 400 `{ error: "invalid_barcode" }` if `barcode` is missing or not a plausible digit string.
 * - 502 `{ error: "provider_error" }` if Open Food Facts itself can't be reached / errors.
 * - 200 `{ candidate: null }` when the barcode isn't found, or is found but has no usable
 *   nutrition data (dropped by `normalizeOpenFoodFactsProduct`) — both are simply "no match" to
 *   the caller, which falls back to manual entry either way.
 * - 200 `{ candidate: FoodCandidate }` on a usable match.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const barcode = (searchParams.get("barcode") ?? "").trim();
  if (!BARCODE_PATTERN.test(barcode)) {
    return NextResponse.json({ error: "invalid_barcode" }, { status: 400 });
  }

  const result = await fetchOpenFoodFactsProduct(barcode);
  if (!result.ok) {
    return NextResponse.json({ error: "provider_error" }, { status: 502 });
  }
  if (!result.found) {
    return NextResponse.json({ candidate: null });
  }

  return NextResponse.json({ candidate: normalizeOpenFoodFactsProduct(result.product, barcode) });
}

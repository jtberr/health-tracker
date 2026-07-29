import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the Open Food Facts server adapter, covering the two qa-reviewer fixes applied
 * directly to this file:
 * - N-1: every outbound fetch carries an AbortSignal-based timeout, so a hung request eventually
 *   fails instead of hanging the caller forever.
 * - N-3: the base URL is read from `OPEN_FOOD_FACTS_BASE_URL` (falling back to the real default),
 *   giving a test/CI seam to redirect the outbound call without stubbing global `fetch`.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ status: 1, product: { product_name: "X" } }));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("fetchOpenFoodFactsProduct", () => {
  it("passes an AbortSignal on every outbound call (N-1)", async () => {
    const { fetchOpenFoodFactsProduct } = await import("./openfoodfacts");
    await fetchOpenFoodFactsProduct("012345678905");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the real default base URL when OPEN_FOOD_FACTS_BASE_URL is unset", async () => {
    const { fetchOpenFoodFactsProduct } = await import("./openfoodfacts");
    await fetchOpenFoodFactsProduct("012345678905");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    expect(String(url)).toContain("world.openfoodfacts.org");
  });

  it("honors OPEN_FOOD_FACTS_BASE_URL as a test/CI injection seam (N-3)", async () => {
    vi.stubEnv("OPEN_FOOD_FACTS_BASE_URL", "http://127.0.0.1:9999/mock-off");
    const { fetchOpenFoodFactsProduct } = await import("./openfoodfacts");
    await fetchOpenFoodFactsProduct("012345678905");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    expect(String(url)).toContain("127.0.0.1:9999/mock-off");
    expect(String(url)).not.toContain("world.openfoodfacts.org");
  });

  it("treats an aborted/rejected fetch as an ordinary transport failure", async () => {
    fetchSpy.mockRejectedValue(new DOMException("The operation was aborted.", "AbortError"));
    const { fetchOpenFoodFactsProduct } = await import("./openfoodfacts");

    const result = await fetchOpenFoodFactsProduct("012345678905");
    expect(result).toEqual({ ok: false });
  });

  it("treats OFF's real HTTP 404 'not found' response as found:false, not a provider error", async () => {
    // Confirmed 2026-07-29 against the live v2 API: an unknown barcode comes back as HTTP 404
    // with a normal JSON body, not HTTP 200 as earlier testing had assumed. Before this fix,
    // `!response.ok` short-circuited before the body was ever parsed, so every genuinely
    // not-found barcode was misreported as a provider error (502) instead of a graceful
    // manual-entry fallback.
    fetchSpy.mockResolvedValue(
      jsonResponse({ code: "00228380", status: 0, status_verbose: "product not found" }, 404)
    );
    const { fetchOpenFoodFactsProduct } = await import("./openfoodfacts");

    const result = await fetchOpenFoodFactsProduct("228380");
    expect(result).toEqual({ ok: true, found: false });
  });

  it("still treats a genuine 5xx as a provider error", async () => {
    fetchSpy.mockResolvedValue(new Response("Internal Server Error", { status: 500 }));
    const { fetchOpenFoodFactsProduct } = await import("./openfoodfacts");

    const result = await fetchOpenFoodFactsProduct("012345678905");
    expect(result).toEqual({ ok: false });
  });

  it("treats a 404 with an unparseable body as a provider error, not a silent not-found", async () => {
    fetchSpy.mockResolvedValue(new Response("not json", { status: 404 }));
    const { fetchOpenFoodFactsProduct } = await import("./openfoodfacts");

    const result = await fetchOpenFoodFactsProduct("012345678905");
    expect(result).toEqual({ ok: false });
  });
});

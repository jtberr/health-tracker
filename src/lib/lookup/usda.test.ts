import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the USDA FoodData Central server adapter, covering the two qa-reviewer fixes
 * applied directly to this file:
 * - N-1: every outbound fetch carries an AbortSignal-based timeout.
 * - N-3: the search URL is read from `USDA_SEARCH_URL` (falling back to the real default), giving
 *   a test/CI seam to redirect the outbound call without stubbing global `fetch`.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  fetchSpy = vi.fn().mockResolvedValue(jsonResponse({ foods: [] }));
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("searchUsdaFoods", () => {
  it("passes an AbortSignal on every outbound call (N-1)", async () => {
    const { searchUsdaFoods } = await import("./usda");
    await searchUsdaFoods("chicken", "test-key");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the real default search URL when USDA_SEARCH_URL is unset", async () => {
    const { searchUsdaFoods } = await import("./usda");
    await searchUsdaFoods("chicken", "test-key");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    expect(new URL(String(url)).host).toBe("api.nal.usda.gov");
  });

  it("honors USDA_SEARCH_URL as a test/CI injection seam (N-3)", async () => {
    vi.stubEnv("USDA_SEARCH_URL", "http://127.0.0.1:9999/mock-usda");
    const { searchUsdaFoods } = await import("./usda");
    await searchUsdaFoods("chicken", "test-key");

    const [url] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    const outbound = new URL(String(url));
    expect(outbound.host).toBe("127.0.0.1:9999");
    expect(outbound.pathname).toBe("/mock-usda");
    // Query params are still appended on top of the overridden base URL.
    expect(outbound.searchParams.get("query")).toBe("chicken");
  });

  it("treats an aborted/rejected fetch as an ordinary transport failure", async () => {
    fetchSpy.mockRejectedValue(new DOMException("The operation was aborted.", "AbortError"));
    const { searchUsdaFoods } = await import("./usda");

    const result = await searchUsdaFoods("chicken", "test-key");
    expect(result).toEqual({ ok: false });
  });
});

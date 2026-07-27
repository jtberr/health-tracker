import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetLookupRateLimitForTests } from "@/lib/lookup/rate-limit";

const getUser = vi.fn();
const searchUsdaFoods = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser },
  })),
}));

vi.mock("@/lib/lookup/usda", () => ({
  searchUsdaFoods,
}));

function makeRequest(url: string): Request {
  return new Request(url);
}

describe("GET /api/lookup/search", () => {
  const originalApiKey = process.env.USDA_FDC_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    _resetLookupRateLimitForTests();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
    process.env.USDA_FDC_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.USDA_FDC_API_KEY = originalApiKey;
    _resetLookupRateLimitForTests();
  });

  it("401s when there is no authenticated session, without calling the provider", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { GET } = await import("./route");

    const response = await GET(makeRequest("http://localhost/api/lookup/search?query=chicken"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(searchUsdaFoods).not.toHaveBeenCalled();
  });

  it("400s on a missing query param", async () => {
    const { GET } = await import("./route");
    const response = await GET(makeRequest("http://localhost/api/lookup/search"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_query" });
    expect(searchUsdaFoods).not.toHaveBeenCalled();
  });

  it("400s on a blank/whitespace-only query param", async () => {
    const { GET } = await import("./route");
    const response = await GET(makeRequest("http://localhost/api/lookup/search?query=%20%20"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_query" });
  });

  it("502s when the USDA API key isn't configured, without calling the provider", async () => {
    delete process.env.USDA_FDC_API_KEY;
    const { GET } = await import("./route");

    const response = await GET(makeRequest("http://localhost/api/lookup/search?query=chicken"));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "provider_error" });
    expect(searchUsdaFoods).not.toHaveBeenCalled();
  });

  it("502s when the provider can't be reached", async () => {
    searchUsdaFoods.mockResolvedValue({ ok: false });
    const { GET } = await import("./route");

    const response = await GET(makeRequest("http://localhost/api/lookup/search?query=chicken"));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "provider_error" });
  });

  it("never leaks the USDA API key into the response", async () => {
    searchUsdaFoods.mockResolvedValue({ ok: true, foods: [] });
    const { GET } = await import("./route");

    const response = await GET(makeRequest("http://localhost/api/lookup/search?query=chicken"));
    const bodyText = await response.text();

    expect(bodyText).not.toContain("test-key");
    expect(searchUsdaFoods).toHaveBeenCalledWith("chicken", "test-key");
  });

  it("returns normalized, filtered candidates on success", async () => {
    searchUsdaFoods.mockResolvedValue({
      ok: true,
      foods: [
        {
          fdcId: 1,
          description: "Chicken breast, raw",
          foodNutrients: [
            { nutrientId: 1008, nutrientName: "Energy", unitName: "KCAL", value: 120 },
            { nutrientId: 1003, nutrientName: "Protein", unitName: "G", value: 22 },
          ],
        },
        {
          // No usable calorie data -- should be dropped, not surfaced to the client.
          fdcId: 2,
          description: "Unusable Item",
          foodNutrients: [],
        },
      ],
    });
    const { GET } = await import("./route");

    const response = await GET(makeRequest("http://localhost/api/lookup/search?query=chicken"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0]).toMatchObject({ source: "usda", name: "Chicken breast, raw" });
  });

  describe("per-user rate limiting (qa-reviewer N-7)", () => {
    it("429s once a single user exceeds the per-minute limit, without calling USDA", async () => {
      searchUsdaFoods.mockResolvedValue({ ok: true, foods: [] });
      const { GET } = await import("./route");

      // The limiter allows 30 requests/minute per user -- exhaust it, then the next one should
      // be rejected before USDA is ever called.
      for (let i = 0; i < 30; i++) {
        const ok = await GET(makeRequest("http://localhost/api/lookup/search?query=chicken"));
        expect(ok.status).toBe(200);
      }
      searchUsdaFoods.mockClear();

      const limited = await GET(makeRequest("http://localhost/api/lookup/search?query=chicken"));
      expect(limited.status).toBe(429);
      expect(await limited.json()).toEqual({ error: "rate_limited" });
      expect(searchUsdaFoods).not.toHaveBeenCalled();
    });

    it("tracks the limit per-user: a different user is unaffected by another user's usage", async () => {
      searchUsdaFoods.mockResolvedValue({ ok: true, foods: [] });
      const { GET } = await import("./route");

      for (let i = 0; i < 30; i++) {
        await GET(makeRequest("http://localhost/api/lookup/search?query=chicken"));
      }
      const stillLimited = await GET(makeRequest("http://localhost/api/lookup/search?query=chicken"));
      expect(stillLimited.status).toBe(429);

      getUser.mockResolvedValue({ data: { user: { id: "user-2" } } });
      const otherUser = await GET(makeRequest("http://localhost/api/lookup/search?query=chicken"));
      expect(otherUser.status).toBe(200);
    });
  });
});

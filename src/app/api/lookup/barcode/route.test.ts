import { beforeEach, describe, expect, it, vi } from "vitest";

const getUser = vi.fn();
const fetchOpenFoodFactsProduct = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser },
  })),
}));

vi.mock("@/lib/lookup/openfoodfacts", () => ({
  fetchOpenFoodFactsProduct,
}));

function makeRequest(url: string): Request {
  return new Request(url);
}

describe("GET /api/lookup/barcode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: "user-1" } } });
  });

  it("401s when there is no authenticated session, without calling the provider", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    const { GET } = await import("./route");

    const response = await GET(makeRequest("http://localhost/api/lookup/barcode?barcode=012345678905"));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(fetchOpenFoodFactsProduct).not.toHaveBeenCalled();
  });

  it("400s on a missing barcode param", async () => {
    const { GET } = await import("./route");
    const response = await GET(makeRequest("http://localhost/api/lookup/barcode"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_barcode" });
    expect(fetchOpenFoodFactsProduct).not.toHaveBeenCalled();
  });

  it("400s on a non-numeric barcode param", async () => {
    const { GET } = await import("./route");
    const response = await GET(makeRequest("http://localhost/api/lookup/barcode?barcode=not-a-code"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_barcode" });
  });

  it("502s when the provider can't be reached", async () => {
    fetchOpenFoodFactsProduct.mockResolvedValue({ ok: false });
    const { GET } = await import("./route");

    const response = await GET(makeRequest("http://localhost/api/lookup/barcode?barcode=012345678905"));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "provider_error" });
  });

  it("returns a null candidate when the barcode isn't found", async () => {
    fetchOpenFoodFactsProduct.mockResolvedValue({ ok: true, found: false });
    const { GET } = await import("./route");

    const response = await GET(makeRequest("http://localhost/api/lookup/barcode?barcode=012345678905"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ candidate: null });
  });

  it("returns a normalized candidate on a usable match", async () => {
    fetchOpenFoodFactsProduct.mockResolvedValue({
      ok: true,
      found: true,
      product: {
        product_name: "Test Product",
        nutriments: { "energy-kcal_100g": 200, proteins_100g: 10 },
      },
    });
    const { GET } = await import("./route");

    const response = await GET(makeRequest("http://localhost/api/lookup/barcode?barcode=012345678905"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.candidate).toMatchObject({
      source: "openfoodfacts",
      sourceId: "012345678905",
      name: "Test Product",
    });
  });

  it("returns a null candidate when the product is found but has no usable nutrition data", async () => {
    fetchOpenFoodFactsProduct.mockResolvedValue({
      ok: true,
      found: true,
      product: { product_name: "No Nutrition Data" },
    });
    const { GET } = await import("./route");

    const response = await GET(makeRequest("http://localhost/api/lookup/barcode?barcode=012345678905"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ candidate: null });
  });
});

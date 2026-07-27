/**
 * QA-REVIEWER independent Phase 6 tests for the two auth-gated lookup Route Handlers.
 * Written from docs/architecture/food-weight-tracker.md 8/6, AGENTS.md Absolute Rules and
 * "What Not To Do", and the DECISIONS entry "Food lookup ... via a server-side proxy".
 * NOT derived from the developer route tests, which mock the lib/lookup adapters. These stub
 * globalThis.fetch instead, so the REAL adapter code runs and the actual outbound request can be
 * inspected -- which is the only way to prove that nothing but the barcode/query text leaves the
 * system, and that no provider call happens at all on the unauthenticated path.
 *
 * These live at the vitest layer deliberately: the acceptance bullets "401 unauthenticated
 * before any external provider call" and "only the barcode/search text ever leaves the system"
 * can only be proved by observing the server outbound fetch, and the provider base URLs are
 * hardcoded constants with no injection seam (see the QA report). Stubbing globalThis.fetch is
 * the only way to assert on the real outbound request.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const getUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser } }),
}));

import { GET as barcodeGET } from "@/app/api/lookup/barcode/route";
import { GET as searchGET } from "@/app/api/lookup/search/route";

const TEST_KEY = "qa-secret-usda-key-8675309";

function signedIn() {
  getUser.mockResolvedValue({ data: { user: { id: "user-123", email: "qa@example.test" } } });
}
function signedOut() {
  getUser.mockResolvedValue({ data: { user: null } });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("USDA_FDC_API_KEY", TEST_KEY);
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function bodyText(res: Response): Promise<string> {
  return await res.clone().text();
}

function allHeaderText(res: Response): string {
  return [...res.headers.entries()].map(([k, v]) => k + ":" + v).join("\n");
}

describe("auth-gating on /api/lookup/* (401 BEFORE any provider call)", () => {
  it("barcode: unauthenticated returns 401 and the provider is never invoked", async () => {
    signedOut();
    const res = await barcodeGET(new Request("http://localhost/api/lookup/barcode?barcode=012345678905"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthenticated" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("search: unauthenticated returns 401 and the provider is never invoked", async () => {
    signedOut();
    const res = await searchGET(new Request("http://localhost/api/lookup/search?query=chicken"));
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: "unauthenticated" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("search: an unauthenticated 401 response never contains the API key", async () => {
    signedOut();
    const res = await searchGET(new Request("http://localhost/api/lookup/search?query=chicken"));
    expect(await bodyText(res)).not.toContain(TEST_KEY);
    expect(allHeaderText(res)).not.toContain(TEST_KEY);
  });
});

describe("input validation happens before the provider is called", () => {
  it("search: empty query returns 400 invalid_query with no outbound call", async () => {
    signedIn();
    const res = await searchGET(new Request("http://localhost/api/lookup/search?query="));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid_query" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("search: whitespace-only query returns 400 invalid_query", async () => {
    signedIn();
    const res = await searchGET(new Request("http://localhost/api/lookup/search?query=%20%20%20"));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("search: missing query param entirely returns 400 invalid_query", async () => {
    signedIn();
    const res = await searchGET(new Request("http://localhost/api/lookup/search"));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("barcode: non-numeric barcode returns 400 invalid_barcode with no outbound call", async () => {
    signedIn();
    const res = await barcodeGET(new Request("http://localhost/api/lookup/barcode?barcode=not-a-code"));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "invalid_barcode" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("barcode: missing param returns 400 invalid_barcode", async () => {
    signedIn();
    const res = await barcodeGET(new Request("http://localhost/api/lookup/barcode"));
    expect(res.status).toBe(400);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("nothing but the barcode / query text leaves the system", () => {
  it("barcode: the outbound OFF request carries only the barcode, no identity, no cookies", async () => {
    signedIn();
    fetchSpy.mockResolvedValue(
      jsonResponse({ status: 1, product: { product_name: "X", nutriments: { "energy-kcal_100g": 100 } } }),
    );
    const request = new Request("http://localhost/api/lookup/barcode?barcode=012345678905", {
      headers: { cookie: "sb-access-token=SUPER-SECRET-SESSION; other=1" },
    });
    await barcodeGET(request);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    const outbound = new URL(String(url));
    expect(outbound.host).toBe("world.openfoodfacts.org");
    expect(outbound.pathname).toContain("012345678905");
    expect(outbound.search).toBe("");

    const serialized = JSON.stringify({ url: String(url), init });
    for (const secret of ["qa@example.test", "user-123", "SUPER-SECRET-SESSION", "sb-access-token"]) {
      expect(serialized).not.toContain(secret);
    }
    const headers = new Headers((init?.headers ?? {}) as HeadersInit);
    expect(headers.get("cookie")).toBeNull();
    expect(headers.get("authorization")).toBeNull();
  });

  it("search: the outbound USDA request carries only the query text, key and pageSize", async () => {
    signedIn();
    fetchSpy.mockResolvedValue(jsonResponse({ foods: [] }));
    const request = new Request("http://localhost/api/lookup/search?query=grilled%20chicken", {
      headers: { cookie: "sb-access-token=SUPER-SECRET-SESSION" },
    });
    await searchGET(request);

    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit | undefined];
    const outbound = new URL(String(url));
    expect(outbound.host).toBe("api.nal.usda.gov");
    expect(outbound.searchParams.get("query")).toBe("grilled chicken");
    expect([...outbound.searchParams.keys()].sort()).toEqual(["api_key", "pageSize", "query"]);

    const serialized = JSON.stringify({ url: String(url), init });
    for (const secret of ["qa@example.test", "user-123", "SUPER-SECRET-SESSION", "sb-access-token"]) {
      expect(serialized).not.toContain(secret);
    }
    const headers = new Headers((init?.headers ?? {}) as HeadersInit);
    expect(headers.get("cookie")).toBeNull();
  });
});

describe("the USDA key never reaches the client", () => {
  it("a successful search response contains the key in neither body nor headers", async () => {
    signedIn();
    fetchSpy.mockResolvedValue(
      jsonResponse({
        foods: [
          {
            fdcId: 1,
            description: "Chicken breast",
            foodNutrients: [
              { nutrientId: 1008, value: 165 },
              { nutrientId: 1003, value: 31 },
            ],
          },
        ],
      }),
    );
    const res = await searchGET(new Request("http://localhost/api/lookup/search?query=chicken"));
    expect(res.status).toBe(200);
    expect(await bodyText(res)).not.toContain(TEST_KEY);
    expect(allHeaderText(res)).not.toContain(TEST_KEY);
  });

  it("a provider failure response contains the key in neither body nor headers", async () => {
    signedIn();
    fetchSpy.mockResolvedValue(new Response("Invalid API key: " + TEST_KEY, { status: 403 }));
    const res = await searchGET(new Request("http://localhost/api/lookup/search?query=chicken"));
    expect(res.status).toBe(502);
    const text = await bodyText(res);
    expect(text).not.toContain(TEST_KEY);
    expect(JSON.parse(text)).toEqual({ error: "provider_error" });
    expect(allHeaderText(res)).not.toContain(TEST_KEY);
  });

  it("a thrown transport error whose message embeds the URL and key is not echoed to the client", async () => {
    signedIn();
    fetchSpy.mockRejectedValue(
      new Error("request to https://api.nal.usda.gov/fdc/v1/foods/search?query=x&api_key=" + TEST_KEY + " failed"),
    );
    const res = await searchGET(new Request("http://localhost/api/lookup/search?query=chicken"));
    expect(res.status).toBe(502);
    expect(await bodyText(res)).not.toContain(TEST_KEY);
  });

  it("an unset USDA key returns 502 provider_error and USDA is never contacted", async () => {
    signedIn();
    vi.stubEnv("USDA_FDC_API_KEY", "");
    const res = await searchGET(new Request("http://localhost/api/lookup/search?query=chicken"));
    expect(res.status).toBe(502);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("provider failures degrade gracefully instead of crashing the route", () => {
  it("barcode: provider 500 returns 502 provider_error", async () => {
    signedIn();
    fetchSpy.mockResolvedValue(new Response("boom", { status: 500 }));
    const res = await barcodeGET(new Request("http://localhost/api/lookup/barcode?barcode=012345678905"));
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({ error: "provider_error" });
  });

  it("barcode: network rejection (closest analog to a timeout) returns 502 and does not throw", async () => {
    signedIn();
    fetchSpy.mockRejectedValue(new TypeError("fetch failed"));
    const res = await barcodeGET(new Request("http://localhost/api/lookup/barcode?barcode=012345678905"));
    expect(res.status).toBe(502);
  });

  it("barcode: non-JSON provider body returns 502 and does not throw", async () => {
    signedIn();
    fetchSpy.mockResolvedValue(new Response("<html>maintenance</html>", { status: 200 }));
    const res = await barcodeGET(new Request("http://localhost/api/lookup/barcode?barcode=012345678905"));
    expect(res.status).toBe(502);
  });

  it("barcode: status not 1 (not found) returns 200 candidate null, a manual fallback not an error", async () => {
    signedIn();
    fetchSpy.mockResolvedValue(jsonResponse({ status: 0, status_verbose: "product not found" }));
    const res = await barcodeGET(new Request("http://localhost/api/lookup/barcode?barcode=012345678905"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ candidate: null });
  });

  it("barcode: found but unusable nutrition returns 200 candidate null (dropped, not garbage)", async () => {
    signedIn();
    fetchSpy.mockResolvedValue(jsonResponse({ status: 1, product: { product_name: "Mystery", nutriments: {} } }));
    const res = await barcodeGET(new Request("http://localhost/api/lookup/barcode?barcode=012345678905"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ candidate: null });
  });

  it("barcode: wildly malformed product shapes never crash the route", async () => {
    signedIn();
    for (const product of [null, 42, "a string", [], { product_name: 5 }, { nutriments: "nope" }]) {
      fetchSpy.mockResolvedValue(jsonResponse({ status: 1, product }));
      const res = await barcodeGET(new Request("http://localhost/api/lookup/barcode?barcode=012345678905"));
      expect([200, 502]).toContain(res.status);
    }
  });

  it("search: a non-array foods field returns 200 with an empty candidate list", async () => {
    signedIn();
    fetchSpy.mockResolvedValue(jsonResponse({ foods: { nope: true } }));
    const res = await searchGET(new Request("http://localhost/api/lookup/search?query=chicken"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ candidates: [] });
  });

  it("search: junk entries inside foods are dropped while usable ones survive", async () => {
    signedIn();
    fetchSpy.mockResolvedValue(
      jsonResponse({
        foods: [
          null,
          "garbage",
          { description: "No nutrients" },
          {
            fdcId: 7,
            description: "Egg",
            foodNutrients: [
              { nutrientId: 1008, value: 143 },
              { nutrientId: 1003, value: 12.6 },
            ],
          },
        ],
      }),
    );
    const res = await searchGET(new Request("http://localhost/api/lookup/search?query=egg"));
    const body = (await res.json()) as { candidates: Array<{ name: string }> };
    expect(body.candidates).toHaveLength(1);
    expect(body.candidates[0].name).toBe("Egg");
  });
});

import { test, expect, type Page, type Route } from "@playwright/test";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";
import type { FoodCandidate } from "../src/lib/domain/lookup";

/**
 * QA-REVIEWER independent Phase 6 acceptance suite (food lookup: barcode + description search).
 * Written from docs/architecture/food-weight-tracker.md 8 Phase 6 / 6, AGENTS.md Absolute Rules
 * and "What Not To Do", and the DECISIONS entry "Food lookup ... via a server-side proxy".
 * The developer shipped no e2e coverage for this phase (unit + route tests only), so nothing
 * here is derived from an existing spec.
 *
 * Provider mocking: the shipped adapters hardcode the provider base URLs with no injection seam,
 * so a Playwright test cannot intercept the SERVER side outbound call. UI flows are therefore
 * mocked at the app own proxy boundary (/api/lookup/*), while the Route Handlers themselves are
 * covered independently at the vitest layer (src/lib/lookup/api-routes.qa.test.ts) where
 * globalThis.fetch can be stubbed. See the QA report.
 */

async function logIn(page: Page, user: TestUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
}

async function entriesFor(user: TestUser) {
  const client = await createUserClient(user);
  const { data, error } = await client.from("food_entries").select("*");
  if (error) throw new Error("food_entries read failed: " + error.message);
  return data ?? [];
}

function candidate(overrides: Partial<FoodCandidate> = {}): FoodCandidate {
  return {
    source: "openfoodfacts",
    sourceId: "012345678905",
    name: "QA Protein Bar",
    quantity: 2,
    unit: "bar",
    caloriesPerUnit: 100,
    proteinGPerUnit: 5,
    ...overrides,
  };
}

async function openLookup(page: Page) {
  await page.getByRole("button", { name: "Look up a food (barcode or search)" }).click();
}

async function mockBarcode(page: Page, handler: (route: Route) => void | Promise<void>) {
  await page.route("**/api/lookup/barcode**", handler);
}

async function mockSearch(page: Page, handler: (route: Route) => void | Promise<void>) {
  await page.route("**/api/lookup/search**", handler);
}

test.describe("Phase6 QA: auth-gating on /api/lookup/*", () => {
  test("both lookup routes return 401 to an unauthenticated caller", async ({ request }) => {
    const barcode = await request.get("/api/lookup/barcode?barcode=012345678905");
    expect(barcode.status()).toBe(401);
    expect(await barcode.json()).toEqual({ error: "unauthenticated" });

    const search = await request.get("/api/lookup/search?query=chicken");
    expect(search.status()).toBe(401);
    expect(await search.json()).toEqual({ error: "unauthenticated" });
  });

  test("a 401 body carries no provider payload and no API key", async ({ request }) => {
    const key = process.env.USDA_FDC_API_KEY;
    const res = await request.get("/api/lookup/search?query=chicken");
    const body = await res.text();
    expect(body).not.toContain("foods");
    if (key) expect(body).not.toContain(key);
    for (const [name, value] of Object.entries(res.headers())) {
      if (key) expect(name + ":" + value).not.toContain(key);
    }
  });
});

test.describe("Phase6 QA: request validation and key containment (authenticated)", () => {
  let user: TestUser;
  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("an empty search query returns 400 invalid_query", async ({ page }) => {
    const res = await page.request.get("/api/lookup/search?query=");
    expect(res.status()).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_query" });
  });

  test("a whitespace-only search query returns 400 invalid_query", async ({ page }) => {
    const res = await page.request.get("/api/lookup/search?query=%20%20");
    expect(res.status()).toBe(400);
  });

  test("a missing/garbage barcode returns 400 invalid_barcode", async ({ page }) => {
    const missing = await page.request.get("/api/lookup/barcode");
    expect(missing.status()).toBe(400);
    const garbage = await page.request.get("/api/lookup/barcode?barcode=abc");
    expect(garbage.status()).toBe(400);
    expect(await garbage.json()).toEqual({ error: "invalid_barcode" });
  });

  test("a real search response never echoes the USDA key in body or headers", async ({ page }) => {
    const key = process.env.USDA_FDC_API_KEY;
    test.skip(!key, "USDA_FDC_API_KEY not configured in this environment");
    const res = await page.request.get("/api/lookup/search?query=chicken%20breast", { timeout: 30_000 });
    // 200 with a real key, 502 with a dummy/rejected key or no network -- either way, no leak.
    expect([200, 502]).toContain(res.status());
    const body = await res.text();
    expect(body).not.toContain(key as string);
    expect(body).not.toContain("api_key");
    for (const [name, value] of Object.entries(res.headers())) {
      expect(name + ":" + value).not.toContain(key as string);
    }
  });

  test("no client bundle served to /food contains the USDA key or the provider endpoints", async ({ page }) => {
    const key = process.env.USDA_FDC_API_KEY;
    const scriptUrls: string[] = [];
    page.on("response", (response) => {
      const url = response.url();
      if (url.includes("/_next/") && url.endsWith(".js")) scriptUrls.push(url);
    });
    await page.goto("/food");
    await openLookup(page);
    await page.getByRole("tab", { name: "Barcode" }).click();
    await expect(page.getByLabel("Barcode (UPC/EAN)")).toBeVisible();

    expect(scriptUrls.length).toBeGreaterThan(0);
    for (const url of scriptUrls) {
      const res = await page.request.get(url);
      const text = await res.text();
      if (key) expect(text, url + " leaked the USDA key").not.toContain(key);
      expect(text, url + " embeds the USDA endpoint").not.toContain("api.nal.usda.gov");
      expect(text, url + " embeds the OFF endpoint").not.toContain("world.openfoodfacts.org");
    }
  });
});

test.describe("Phase6 QA: barcode flow (mocked Open Food Facts via the app proxy)", () => {
  let user: TestUser;
  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  async function lookUpBarcode(page: Page, code = "012345678905") {
    await page.goto("/food");
    await openLookup(page);
    await page.getByRole("tab", { name: "Barcode" }).click();
    await page.getByLabel("Barcode (UPC/EAN)").fill(code);
    await page.getByRole("button", { name: "Look up" }).click();
  }

  test("a match prefills name, quantity, unit and per-unit nutrition", async ({ page }) => {
    await mockBarcode(page, (route) => route.fulfill({ json: { candidate: candidate() } }));
    await lookUpBarcode(page);

    await page.getByRole("button", { name: "Use this" }).click();

    await expect(page.getByLabel("Name")).toHaveValue("QA Protein Bar");
    await expect(page.getByRole("spinbutton", { name: "Quantity" })).toHaveValue("2");
    await expect(page.getByLabel("Unit (optional)")).toHaveValue("bar");
    await expect(page.getByLabel("Calories per unit")).toHaveValue("100");
    await expect(page.getByLabel("Protein per unit (g)")).toHaveValue("5");
  });

  test("a not-found response falls back to manual entry with no crash and no wrong data", async ({ page }) => {
    await mockBarcode(page, (route) => route.fulfill({ json: { candidate: null } }));
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    await lookUpBarcode(page);

    await expect(page.getByText("No match found")).toBeVisible();
    // Nothing was silently filled in from a miss.
    await expect(page.getByLabel("Name")).toHaveValue("");

    await page.getByLabel("Name").fill("Hand typed after a miss");
    await page.getByLabel("Total calories").fill("321");
    await page.getByLabel("Total protein (g)").fill("21");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Hand typed after a miss")).toBeVisible();

    const rows = await entriesFor(user);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].calories)).toBe(321);
    expect(consoleErrors).toEqual([]);
  });

  test("a provider error (502) falls back to manual entry rather than crashing", async ({ page }) => {
    await mockBarcode(page, (route) => route.fulfill({ status: 502, json: { error: "provider_error" } }));
    const consoleErrors: string[] = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    await lookUpBarcode(page);

    await expect(page.getByText(/unavailable right now/i)).toBeVisible();
    await expect(page.getByLabel("Name")).toHaveValue("");

    await page.getByLabel("Name").fill("Manual after provider error");
    await page.getByLabel("Total calories").fill("150");
    await page.getByLabel("Total protein (g)").fill("9");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Manual after provider error")).toBeVisible();

    const rows = await entriesFor(user);
    expect(rows).toHaveLength(1);
    expect(consoleErrors).toEqual([]);
  });

  test("a 500 from the proxy is also surfaced as a manual-entry fallback", async ({ page }) => {
    await mockBarcode(page, (route) => route.fulfill({ status: 500, body: "boom" }));
    await lookUpBarcode(page);
    await expect(page.getByText(/unavailable right now/i)).toBeVisible();
  });

  test("a malformed (non-JSON) proxy body does not hang or crash the panel", async ({ page }) => {
    await mockBarcode(page, (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: "<<not json>>" }),
    );
    await lookUpBarcode(page);
    await expect(page.getByText(/unavailable right now/i)).toBeVisible();
  });

  test("the browser never contacts Open Food Facts or USDA directly", async ({ page }) => {
    const thirdParty: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("openfoodfacts.org") || url.includes("api.nal.usda.gov")) thirdParty.push(url);
    });
    await mockBarcode(page, (route) => route.fulfill({ json: { candidate: candidate() } }));
    await lookUpBarcode(page);
    await page.getByRole("button", { name: "Use this" }).click();
    expect(thirdParty).toEqual([]);
  });

  test("N-1 fix: a hung proxy eventually times out instead of loading forever, and manual entry still works", async ({
    page,
  }) => {
    // FoodLookupPanel's client-side fetch now carries an AbortSignal-based timeout
    // (lib/lookup/timeout.ts, LOOKUP_TIMEOUT_MS = 10_000ms) that fires locally in the browser
    // regardless of what the mocked route ever does -- it aborts the fetch itself, not something
    // the (permanently hanging) mocked response needs to cooperate with.
    await mockBarcode(page, async () => {
      await new Promise(() => {});
    });
    await lookUpBarcode(page);
    await expect(page.getByText("Looking up")).toBeVisible();

    // Still within the timeout window: still showing "Looking up...", not yet given up.
    await page.waitForTimeout(6000);
    await expect(page.getByText("Looking up")).toBeVisible();

    // Past the timeout window: the abort has fired and the panel degrades to the same
    // "unavailable right now" manual-entry fallback a real provider/proxy error produces.
    await expect(page.getByText(/unavailable right now/i)).toBeVisible({ timeout: 8000 });
    await expect(page.getByLabel("Name")).toHaveValue("");

    await page.getByLabel("Name").fill("Manual while lookup hangs");
    await page.getByLabel("Total calories").fill("222");
    await page.getByLabel("Total protein (g)").fill("11");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Manual while lookup hangs")).toBeVisible();
    expect(await entriesFor(user)).toHaveLength(1);
  });
});

test.describe("Phase6 QA: search flow, prefilled submit, and no-auto-submit", () => {
  let user: TestUser;
  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  async function runSearch(page: Page, term = "chicken") {
    await page.goto("/food");
    await openLookup(page);
    await page.getByLabel("Search by description").fill(term);
    await page.getByRole("button", { name: "Search", exact: true }).click();
  }

  test("a normal query prefills the picked candidate", async ({ page }) => {
    await mockSearch(page, (route) =>
      route.fulfill({
        json: {
          candidates: [
            candidate({ source: "usda", sourceId: "111", name: "USDA Chicken", quantity: 100, unit: "g", caloriesPerUnit: 1.65, proteinGPerUnit: 0.31 }),
            candidate({ source: "usda", sourceId: "222", name: "USDA Turkey", quantity: 100, unit: "g", caloriesPerUnit: 1.35, proteinGPerUnit: 0.29 }),
          ],
        },
      }),
    );
    await runSearch(page);
    await expect(page.getByText("USDA Chicken")).toBeVisible();
    await expect(page.getByText("USDA Turkey")).toBeVisible();

    await page.getByRole("listitem").filter({ hasText: "USDA Chicken" }).getByRole("button", { name: "Use this" }).click();
    await expect(page.getByLabel("Name")).toHaveValue("USDA Chicken");
    await expect(page.getByRole("spinbutton", { name: "Quantity" })).toHaveValue("100");
    await expect(page.getByLabel("Unit (optional)")).toHaveValue("g");
    await expect(page.getByLabel("Calories per unit")).toHaveValue("1.65");
  });

  test("a zero-result search shows the manual fallback message", async ({ page }) => {
    await mockSearch(page, (route) => route.fulfill({ json: { candidates: [] } }));
    await runSearch(page, "zzzznotafood");
    await expect(page.getByText("No match found")).toBeVisible();
  });

  test("a search provider error degrades to manual entry", async ({ page }) => {
    await mockSearch(page, (route) => route.fulfill({ status: 502, json: { error: "provider_error" } }));
    await runSearch(page);
    await expect(page.getByText(/unavailable right now/i)).toBeVisible();
  });

  test("lookup is optional: an entry saves with hand-typed values and no lookup at all", async ({ page }) => {
    await page.goto("/food");
    await page.getByLabel("Name").fill("No lookup needed");
    await page.getByLabel("Total calories").fill("400");
    await page.getByLabel("Total protein (g)").fill("30");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("No lookup needed")).toBeVisible();

    const rows = await entriesFor(user);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].calories)).toBe(400);
    expect(Number(rows[0].protein_g)).toBe(30);
  });

  test("picking a candidate NEVER auto-submits: a row appears only after an explicit submit", async ({ page }) => {
    await mockSearch(page, (route) => route.fulfill({ json: { candidates: [candidate({ source: "usda", sourceId: "333", name: "Never auto saved" })] } }));
    await runSearch(page);
    await page.getByRole("button", { name: "Use this" }).click();

    await expect(page.getByLabel("Name")).toHaveValue("Never auto saved");
    // Give any stray submit a chance to land before asserting nothing happened.
    await page.waitForTimeout(1500);
    expect(await entriesFor(user)).toHaveLength(0);

    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Never auto saved")).toBeVisible();
    expect(await entriesFor(user)).toHaveLength(1);
  });

  test("a prefilled candidate plus a quantity adjustment stores quantity x per-unit, not the original total", async ({ page }) => {
    await mockSearch(page, (route) =>
      route.fulfill({ json: { candidates: [candidate({ source: "usda", sourceId: "444", name: "Adjusted bar", quantity: 2, unit: "bar", caloriesPerUnit: 100, proteinGPerUnit: 5 })] } }),
    );
    await runSearch(page);
    await page.getByRole("button", { name: "Use this" }).click();
    await expect(page.getByRole("spinbutton", { name: "Quantity" })).toHaveValue("2");

    await page.getByRole("spinbutton", { name: "Quantity" }).fill("5");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Adjusted bar")).toBeVisible();

    const rows = await entriesFor(user);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].quantity)).toBe(5);
    expect(Number(rows[0].calories_per_unit)).toBe(100);
    expect(Number(rows[0].protein_g_per_unit)).toBe(5);
    // 5 x 100 = 500, NOT the 200 the candidate originally described.
    expect(Number(rows[0].calories)).toBe(500);
    expect(Number(rows[0].protein_g)).toBe(25);
  });
});

test.describe("Phase6 QA: the lookup panel must never submit the outer food-entry form", () => {
  let user: TestUser;
  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("no form element is nested inside the food-entry form (illegal nested form)", async ({ page }) => {
    await page.goto("/food");
    await openLookup(page);
    await expect(page.locator("form form")).toHaveCount(0);
    await page.getByRole("tab", { name: "Barcode" }).click();
    await expect(page.locator("form form")).toHaveCount(0);
  });

  test("clicking Search does not submit the entry form", async ({ page }) => {
    await mockSearch(page, (route) => route.fulfill({ json: { candidates: [] } }));
    await page.goto("/food");
    // Fill the outer form first: if the Search click submitted it, a row WOULD be created.
    await page.getByLabel("Name").fill("Must not be saved by Search");
    await page.getByLabel("Total calories").fill("111");
    await page.getByLabel("Total protein (g)").fill("11");

    await openLookup(page);
    await page.getByLabel("Search by description").fill("anything");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByText("No match found")).toBeVisible();
    await page.waitForTimeout(1000);

    expect(await entriesFor(user)).toHaveLength(0);
    await expect(page).toHaveURL(/\/food/);
    await expect(page.getByLabel("Name")).toHaveValue("Must not be saved by Search");
  });

  test("pressing Enter in the search box does not submit the entry form", async ({ page }) => {
    await mockSearch(page, (route) => route.fulfill({ json: { candidates: [] } }));
    await page.goto("/food");
    await page.getByLabel("Name").fill("Must not be saved by Enter");
    await page.getByLabel("Total calories").fill("112");
    await page.getByLabel("Total protein (g)").fill("12");

    await openLookup(page);
    await page.getByLabel("Search by description").fill("anything");
    await page.getByLabel("Search by description").press("Enter");
    await expect(page.getByText("No match found")).toBeVisible();
    await page.waitForTimeout(1000);

    expect(await entriesFor(user)).toHaveLength(0);
  });

  test("clicking Look up on the barcode tab does not submit the entry form", async ({ page }) => {
    await mockBarcode(page, (route) => route.fulfill({ json: { candidate: null } }));
    await page.goto("/food");
    await page.getByLabel("Name").fill("Must not be saved by Look up");
    await page.getByLabel("Total calories").fill("113");
    await page.getByLabel("Total protein (g)").fill("13");

    await openLookup(page);
    await page.getByRole("tab", { name: "Barcode" }).click();
    await page.getByLabel("Barcode (UPC/EAN)").fill("012345678905");
    await page.getByRole("button", { name: "Look up" }).click();
    await expect(page.getByText("No match found")).toBeVisible();
    await page.waitForTimeout(1000);

    expect(await entriesFor(user)).toHaveLength(0);
  });

  test("pressing Enter in the barcode box does not submit the entry form", async ({ page }) => {
    await mockBarcode(page, (route) => route.fulfill({ json: { candidate: null } }));
    await page.goto("/food");
    await page.getByLabel("Name").fill("Must not be saved by barcode Enter");
    await page.getByLabel("Total calories").fill("114");
    await page.getByLabel("Total protein (g)").fill("14");

    await openLookup(page);
    await page.getByRole("tab", { name: "Barcode" }).click();
    await page.getByLabel("Barcode (UPC/EAN)").fill("012345678905");
    await page.getByLabel("Barcode (UPC/EAN)").press("Enter");
    await expect(page.getByText("No match found")).toBeVisible();
    await page.waitForTimeout(1000);

    expect(await entriesFor(user)).toHaveLength(0);
  });

  test("the tab, Close and expander controls do not submit the entry form either", async ({ page }) => {
    await page.goto("/food");
    await page.getByLabel("Name").fill("Must not be saved by chrome controls");
    await page.getByLabel("Total calories").fill("115");
    await page.getByLabel("Total protein (g)").fill("15");

    await openLookup(page);
    await page.getByRole("tab", { name: "Barcode" }).click();
    await page.getByRole("tab", { name: "Search" }).click();
    await page.getByRole("button", { name: "Close" }).click();
    await page.getByRole("button", { name: "+ Add detail (quantity, unit)" }).click();
    await page.waitForTimeout(1000);

    expect(await entriesFor(user)).toHaveLength(0);
    await expect(page.getByLabel("Name")).toHaveValue("Must not be saved by chrome controls");
  });
});

test.describe("Phase6 QA: a prefilled candidate must never be silently mis-totalled", () => {
  let user: TestUser;
  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  // BLOCKING FINDING (expected to fail until fixed -- see the QA report).
  // FoodEntryForm renders hidden overrides <input name="quantity" value="1"> and
  // <input name="unit" value=""> whenever the detail section is collapsed. After a lookup pick
  // the detail section is auto-expanded, but the "Hide detail" button is still offered; clicking
  // it re-activates those overrides while the calories field keeps its PER-UNIT value and its
  // "Calories per unit" label. A 100 g / 2.02 kcal-per-g candidate (the basis the majority of
  // USDA search results and every serving-less OFF product come back on) then saves as
  // 1 x 2.02 = 2 kcal instead of 202 kcal, with nothing on screen indicating the loss.
  test("collapsing Add detail after a pick must not silently drop the candidate quantity", async ({ page }) => {
    await mockSearch(page, (route) =>
      route.fulfill({
        json: {
          candidates: [
            candidate({ source: "usda", sourceId: "555", name: "Per-100g candidate", quantity: 100, unit: "g", caloriesPerUnit: 2.02, proteinGPerUnit: 0.21 }),
          ],
        },
      }),
    );
    await page.goto("/food");
    await openLookup(page);
    await page.getByLabel("Search by description").fill("chicken");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("button", { name: "Use this" }).click();
    await expect(page.getByRole("spinbutton", { name: "Quantity" })).toHaveValue("100");

    await page.getByRole("button", { name: "Hide detail" }).click();
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Per-100g candidate")).toBeVisible();

    const rows = await entriesFor(user);
    expect(rows).toHaveLength(1);
    // The candidate described 202 kcal. Whatever the form does with a collapsed detail section,
    // it must not silently record 2.
    expect(Number(rows[0].calories)).toBeCloseTo(202, 0);
  });
});

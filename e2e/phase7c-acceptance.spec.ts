import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";

/**
 * QA-REVIEWER independent Phase 7c acceptance suite -- "Saved-meals library: ordering, filtering,
 * and counts".
 *
 * Written from docs/architecture/food-weight-tracker.md 3.4's "Finding a meal in a growing
 * saved-meals library" block, 3.3 (lib/domain/meals.ts helper contracts), 5 (the two tripwires),
 * 6's "Saved-meals library ordering, filtering and counts" test rows, and 8 Phase 7c's In/Out
 * scope + Definition of Done -- plus ai-context/DECISIONS.md's "Saved-meals list scaling is a
 * findability problem, not a data-volume one..." entry. NOT written from the developer's own
 * src/lib/domain/meals.test.ts or from MealsView.tsx (read only afterwards, to look for gaps).
 *
 * The two rows 8 Phase 7c singles out to hammer are covered first and hardest:
 *   (1) the two empty states are DISTINCT -- a user with a real library and a typo'd filter must
 *       never see the "create your first meal" copy;
 *   (2) NO data is hidden -- a 60-meal fixture renders all 60 on BOTH surfaces with the filter
 *       cleared, proving no cap or .limit() crept in while "handling scale".
 *
 * Fixtures are seeded through the RLS-scoped anon client (never service-role), so every meal is
 * genuinely the acting user's own. The browser is pinned to UTC so /food's "today" is
 * deterministic and no Day-input navigation is needed -- deliberately sidestepping the documented
 * pre-existing FoodDayView Day-input race rather than inheriting it.
 */

test.use({ timezoneId: "UTC" });

/** Meal-name headings on /meals, in DOM order. The page h1 is text-2xl, so this matches cards only. */
const MEAL_NAME_SELECTOR = "p.font-serif.text-lg";

/** MealList's genuinely-empty-library copy. Must never appear for a user who HAS meals. */
const EMPTY_LIBRARY_COPY = "No saved meals yet. Create one above to get started.";

async function logIn(page: Page, user: TestUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
}

/** Seeds meals ONE STATEMENT AT A TIME so each row gets a distinct created_at (Postgres now() is
 *  stable per statement) -- otherwise any created_at tie-break assertion would be meaningless. */
async function seedMeals(client: SupabaseClient, userId: string, names: string[]) {
  const created: { id: string; name: string }[] = [];
  for (const name of names) {
    const { data, error } = await client
      .from("meals")
      .insert({ user_id: userId, name })
      .select("id, name")
      .single();
    if (error) throw new Error("Failed to seed meal " + name + ": " + error.message);
    created.push(data as { id: string; name: string });
  }
  return created;
}

async function seedItem(
  client: SupabaseClient,
  userId: string,
  mealId: string,
  name: string,
  sortOrder = 0,
) {
  const { error } = await client.from("meal_items").insert({
    user_id: userId,
    meal_id: mealId,
    name,
    quantity: 1,
    unit: null,
    calories_per_unit: 100,
    protein_g_per_unit: 10,
    sort_order: sortOrder,
  });
  if (error) throw new Error("Failed to seed meal item " + name + ": " + error.message);
}

/** Waits for MealsView to finish its initial load (the "Loading..." placeholder is gone). */
async function waitForMealsLoaded(page: Page) {
  await expect(page.getByText("Loading…", { exact: true })).toHaveCount(0, { timeout: 15_000 });
}

test.describe("Phase 7c - the two empty states are distinct (6: the one to hammer)", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async () => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("a user with ZERO meals sees the create-your-first copy, and no filter box at all", async ({
    page,
  }) => {
    await logIn(page, user);
    await page.goto("/meals");
    await waitForMealsLoaded(page);

    await expect(page.getByText(EMPTY_LIBRARY_COPY)).toBeVisible();
    // 3.4: "The filter box is hidden when meals.length === 0 (nothing to filter)."
    await expect(page.getByLabel("Filter meals")).toHaveCount(0);
    // No count readout either -- there is nothing to orient against.
    await expect(page.getByText(/saved meals?$/)).toHaveCount(0);
  });

  test("a user WITH a real library and a typo'd filter NEVER sees the create-your-first copy", async ({
    page,
  }) => {
    // A 40-meal library: the exact scenario 3.4 says would be "actively misleading" to show the
    // create-your-first-meal copy to.
    const names = Array.from({ length: 40 }, (_, i) => "Meal " + String(i).padStart(2, "0"));
    await seedMeals(client, user.id, names);

    await logIn(page, user);
    await page.goto("/meals");
    await waitForMealsLoaded(page);
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveCount(40);

    await page.getByLabel("Filter meals").fill("chikcen");

    // Zero cards rendered...
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveCount(0);
    // ...but the message is the NO-MATCH one, naming the query...
    await expect(page.getByText('No meals match "chikcen".')).toBeVisible();
    // ...and NOT MealList's empty-library copy. This is the assertion the whole row exists for:
    // checking only that "something" renders would pass even with the two states confused.
    await expect(page.getByText(EMPTY_LIBRARY_COPY)).toHaveCount(0);
    // The library size stays visible so the user can see their 40 meals are still there.
    await expect(page.getByText("Showing 0 of 40")).toBeVisible();
  });

  test("clearing a no-match filter restores the full library (identity, not blank)", async ({
    page,
  }) => {
    await seedMeals(client, user.id, ["Chicken and rice", "Beef stew", "Overnight oats"]);
    await logIn(page, user);
    await page.goto("/meals");
    await waitForMealsLoaded(page);

    const filter = page.getByLabel("Filter meals");
    await filter.fill("zzzz");
    await expect(page.getByText('No meals match "zzzz".')).toBeVisible();

    await filter.fill("");
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveCount(3);
    await expect(page.getByText('No meals match "zzzz".')).toHaveCount(0);
    await expect(page.getByText(EMPTY_LIBRARY_COPY)).toHaveCount(0);
    await expect(page.getByText("3 saved meals")).toBeVisible();
  });

  test("a whitespace-only filter shows the whole library, not a no-match state", async ({ page }) => {
    // 6: the empty/whitespace identity case is "the bug that would blank the page on focus".
    await seedMeals(client, user.id, ["Chicken and rice", "Beef stew"]);
    await logIn(page, user);
    await page.goto("/meals");
    await waitForMealsLoaded(page);

    await page.getByLabel("Filter meals").fill("   ");
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveCount(2);
    await expect(page.getByText("2 saved meals")).toBeVisible();
    await expect(page.getByText(EMPTY_LIBRARY_COPY)).toHaveCount(0);
  });
});

test.describe("Phase 7c - no data is hidden (6: the other one to hammer)", () => {
  let user: TestUser;
  let client: SupabaseClient;
  const SIZE = 60;
  const names = Array.from({ length: SIZE }, (_, i) => "Fixture meal " + String(i).padStart(2, "0"));

  test.beforeAll(async () => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await seedMeals(client, user.id, names);
  });

  test.afterAll(async () => {
    await deleteTestUser(user.id);
  });

  test("all 60 meals render on /meals with the filter cleared, and the count says so", async ({
    page,
  }) => {
    await logIn(page, user);
    await page.goto("/meals");
    await waitForMealsLoaded(page);

    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveCount(SIZE);
    await expect(page.getByText("60 saved meals")).toBeVisible();
    // Every single seeded name must be on the page -- a .limit(50) would still leave 50 cards.
    const rendered = await page.locator(MEAL_NAME_SELECTOR).allTextContents();
    expect(new Set(rendered)).toEqual(new Set(names));
  });

  test("all 60 meals appear in LogMealDialog's picker too (no cap on the /food surface either)", async ({
    page,
  }) => {
    await logIn(page, user);
    await page.goto("/food");
    await page.getByRole("button", { name: "Log a saved meal" }).click();

    const select = page.locator("#log-meal-select");
    await expect(select).toBeVisible({ timeout: 15_000 });
    const optionTexts = await select.locator("option").allTextContents();
    // 60 meals + the disabled "Choose a meal..." placeholder.
    expect(optionTexts).toHaveLength(SIZE + 1);
    for (const name of names) {
      expect(optionTexts.some((t) => t.startsWith(name))).toBe(true);
    }
  });
});

test.describe("Phase 7c - shared alphabetical ordering across both surfaces", () => {
  let user: TestUser;
  let client: SupabaseClient;
  // Deliberately created in an order that is NOT alphabetical, and mixed-case, so a surface that
  // still ordered by created_at (the pre-7c behaviour) or sorted by raw codepoint would differ.
  const creationOrder = ["zucchini bake", "Almond porridge", "chicken and rice", "Beef stew"];
  const alphabetical = ["Almond porridge", "Beef stew", "chicken and rice", "zucchini bake"];

  test.beforeAll(async () => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await seedMeals(client, user.id, creationOrder);
  });

  test.afterAll(async () => {
    await deleteTestUser(user.id);
  });

  test("/meals lists meals case-insensitively alphabetical, not oldest-first", async ({ page }) => {
    await logIn(page, user);
    await page.goto("/meals");
    await waitForMealsLoaded(page);
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveText(alphabetical);
  });

  test("LogMealDialog's picker uses the SAME order, so a meal sits in the same place in both", async ({
    page,
  }) => {
    await logIn(page, user);
    await page.goto("/food");
    await page.getByRole("button", { name: "Log a saved meal" }).click();
    const select = page.locator("#log-meal-select");
    await expect(select).toBeVisible({ timeout: 15_000 });

    const optionTexts = (await select.locator("option").allTextContents()).slice(1);
    const pickerOrder = optionTexts.map((t) => t.replace(/\s*\(\d+ kcal, \d+ items?\)\s*$/, ""));
    expect(pickerOrder).toEqual(alphabetical);
  });

  test("every picker option label STARTS WITH the meal name (native type-ahead is a contract)", async ({
    page,
  }) => {
    // 3.4: "the meal name must remain the FIRST text in each option's label ... because native
    // select type-ahead prefix-matches the option's rendered text."
    await logIn(page, user);
    await page.goto("/food");
    await page.getByRole("button", { name: "Log a saved meal" }).click();
    const select = page.locator("#log-meal-select");
    await expect(select).toBeVisible({ timeout: 15_000 });

    const optionTexts = (await select.locator("option").allTextContents()).slice(1);
    expect(optionTexts).toHaveLength(alphabetical.length);
    optionTexts.forEach((text, i) => {
      expect(text.trim().startsWith(alphabetical[i])).toBe(true);
      expect(text.trim()).toMatch(/\(\d+ kcal, \d+ items?\)$/);
    });
  });
});

test.describe("Phase 7c - duplicate names order deterministically (5: duplicates are legitimate)", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeAll(async () => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    // Three same-named meals, seeded in separate statements so each gets a distinct created_at.
    // Each is given a DIFFERENT number of items, so the rendered "N items" subtitle acts as a
    // visible row identity -- otherwise three cards reading "Snack" could be in any order and no
    // assertion could tell. The tie-break must put them in creation order and keep them there.
    const snacks = await seedMeals(client, user.id, ["Snack", "Snack", "Snack"]);
    await seedItem(client, user.id, snacks[0].id, "First snack item", 0);
    await seedItem(client, user.id, snacks[1].id, "Second snack item a", 0);
    await seedItem(client, user.id, snacks[1].id, "Second snack item b", 1);
    await seedItem(client, user.id, snacks[2].id, "Third snack item a", 0);
    await seedItem(client, user.id, snacks[2].id, "Third snack item b", 1);
    await seedItem(client, user.id, snacks[2].id, "Third snack item c", 2);
    await seedMeals(client, user.id, ["Apple bake"]);
  });

  test.afterAll(async () => {
    await deleteTestUser(user.id);
  });

  test("identical meal names render in created_at order, stable across reloads", async ({ page }) => {
    await logIn(page, user);
    await page.goto("/meals");
    await waitForMealsLoaded(page);

    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveText([
      "Apple bake",
      "Snack",
      "Snack",
      "Snack",
    ]);

    // The item-count subtitles reveal WHICH Snack is where: oldest (1 item) first.
    const subtitles = page.locator(MEAL_NAME_SELECTOR + " + p");
    const firstLoad = await subtitles.allTextContents();
    expect(firstLoad[1]).toContain("1 item ");
    expect(firstLoad[2]).toContain("2 items");
    expect(firstLoad[3]).toContain("3 items");

    await page.reload();
    await waitForMealsLoaded(page);
    expect(await subtitles.allTextContents()).toEqual(firstLoad);
  });

  test("the picker orders the duplicates the same way as /meals", async ({ page }) => {
    await logIn(page, user);
    await page.goto("/food");
    await page.getByRole("button", { name: "Log a saved meal" }).click();
    const select = page.locator("#log-meal-select");
    await expect(select).toBeVisible({ timeout: 15_000 });

    const optionTexts = (await select.locator("option").allTextContents()).slice(1);
    expect(optionTexts[0].trim().startsWith("Apple bake")).toBe(true);
    // Same oldest-first tie-break, visible through each option's item count.
    expect(optionTexts[1]).toContain("1 item)");
    expect(optionTexts[2]).toContain("2 items)");
    expect(optionTexts[3]).toContain("3 items)");
  });
});

test.describe("Phase 7c - filter semantics through the real UI", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeAll(async () => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    const seeded = await seedMeals(client, user.id, [
      "Chicken and rice",
      "Beef stew",
      "CHICKEN salad",
      "Overnight oats",
      "Breakfast",
    ]);
    // "Breakfast" contains no query term used below, but one of its ITEMS is named "Tuna salad".
    // 8 Phase 7c puts item-name matching explicitly Out of scope, so filtering "tuna" must NOT
    // surface this meal. Seeded through a real meal_items row, not a stub.
    const breakfast = seeded.find((m) => m.name === "Breakfast")!;
    await seedItem(client, user.id, breakfast.id, "Tuna salad", 0);
  });

  test.afterAll(async () => {
    await deleteTestUser(user.id);
  });

  test("narrows case-insensitively on a substring, and the count agrees with the cards", async ({
    page,
  }) => {
    await logIn(page, user);
    await page.goto("/meals");
    await waitForMealsLoaded(page);
    await expect(page.getByText("5 saved meals")).toBeVisible();

    const filter = page.getByLabel("Filter meals");

    // Lowercase query against a mixed/upper-case name.
    await filter.fill("chicken");
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveText([
      "Chicken and rice",
      "CHICKEN salad",
    ]);
    await expect(page.getByText("Showing 2 of 5")).toBeVisible();

    // Uppercase query against a lowercase-containing name.
    await filter.fill("STEW");
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveText(["Beef stew"]);
    await expect(page.getByText("Showing 1 of 5")).toBeVisible();

    // Mid-word substring, not a prefix and not a word boundary.
    await filter.fill("vernigh");
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveText(["Overnight oats"]);

    await filter.fill("");
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveCount(5);
    await expect(page.getByText("5 saved meals")).toBeVisible();
  });

  test("multi-token queries are ANDed, not ORed", async ({ page }) => {
    await logIn(page, user);
    await page.goto("/meals");
    await waitForMealsLoaded(page);
    const filter = page.getByLabel("Filter meals");

    // An OR implementation would show BOTH chicken meals here; AND must show only the rice one.
    await filter.fill("chicken rice");
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveText(["Chicken and rice"]);
    await expect(page.getByText("Showing 1 of 5")).toBeVisible();

    // Neither meal contains both tokens.
    await filter.fill("chicken beef");
    await expect(page.getByText('No meals match "chicken beef".')).toBeVisible();
    await expect(page.getByText(EMPTY_LIBRARY_COPY)).toHaveCount(0);
  });

  test("filters on MEAL names only -- an item name never matches (item matching is Out of scope)", async ({
    page,
  }) => {
    await logIn(page, user);
    await page.goto("/meals");
    await waitForMealsLoaded(page);

    // Prove the item really is there and really is named "Tuna salad" before asserting the
    // negative, so this test cannot pass vacuously against a missing fixture.
    await expect(page.getByText("Tuna salad")).toBeVisible();

    await page.getByLabel("Filter meals").fill("tuna");
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveCount(0);
    await expect(page.getByText('No meals match "tuna".')).toBeVisible();

    // ...while a genuine meal-name match on the same card still works.
    await page.getByLabel("Filter meals").fill("breakfast");
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveText(["Breakfast"]);
  });

  test("typing NEVER refetches -- zero Supabase meals requests across the whole interaction", async ({
    page,
  }) => {
    await logIn(page, user);

    const mealsRequests: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/rest/v1/meals") || url.includes("/rest/v1/meal_items")) {
        mealsRequests.push(url);
      }
    });

    await page.goto("/meals");
    await waitForMealsLoaded(page);
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveCount(5);
    const afterInitialLoad = mealsRequests.length;
    expect(afterInitialLoad).toBeGreaterThan(0); // sanity: the listener does observe these calls

    const filter = page.getByLabel("Filter meals");
    for (const q of ["c", "ch", "chi", "chic", "chick", "chicken", "chicken r", "zzz", ""]) {
      await filter.fill(q);
    }
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveCount(5);
    // 3.4: "Typing never refetches -- it filters rows already in memory."
    expect(mealsRequests.length).toBe(afterInitialLoad);
  });
});

test.describe("Phase 7c - nothing else regressed (Phase 7 CRUD / logging still work)", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async () => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("creating a meal while a filter is active: filter survives, and matching decides visibility", async ({
    page,
  }) => {
    await seedMeals(client, user.id, ["Chicken and rice", "Beef stew"]);
    await logIn(page, user);
    await page.goto("/meals");
    await waitForMealsLoaded(page);

    const filter = page.getByLabel("Filter meals");
    await filter.fill("chicken");
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveText(["Chicken and rice"]);

    // A NON-matching new meal: created successfully, but correctly hidden by the active filter.
    await page.getByRole("button", { name: "+ New meal" }).click();
    await page.getByLabel("Meal name").fill("Tofu scramble");
    await page.getByRole("button", { name: "Create meal" }).click();

    await expect(page.getByText("Showing 1 of 3")).toBeVisible();
    await expect(filter).toHaveValue("chicken"); // the refresh must not clear the filter
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveText(["Chicken and rice"]);

    // A MATCHING new meal appears immediately without touching the filter.
    await page.getByRole("button", { name: "+ New meal" }).click();
    await page.getByLabel("Meal name").fill("Chicken soup");
    await page.getByRole("button", { name: "Create meal" }).click();

    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveText([
      "Chicken and rice",
      "Chicken soup",
    ]);
    await expect(page.getByText("Showing 2 of 4")).toBeVisible();
    await expect(filter).toHaveValue("chicken");

    // Clearing shows all four, in shared alphabetical order.
    await filter.fill("");
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveText([
      "Beef stew",
      "Chicken and rice",
      "Chicken soup",
      "Tofu scramble",
    ]);
  });

  test("renaming and deleting still work while a filter is active", async ({ page }) => {
    await seedMeals(client, user.id, ["Chicken and rice", "Chicken salad", "Beef stew"]);
    await logIn(page, user);
    await page.goto("/meals");
    await waitForMealsLoaded(page);

    await page.getByLabel("Filter meals").fill("chicken");
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveCount(2);

    // Rename the first filtered card to something that no longer matches the active filter.
    await page.getByRole("button", { name: "Rename" }).first().click();
    await page.getByLabel("Meal name").fill("Turkey and rice");
    await page.getByRole("button", { name: "Save" }).click();

    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveText(["Chicken salad"]);
    await expect(page.getByText("Showing 1 of 3")).toBeVisible();

    // Delete the remaining filtered card.
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "Delete" }).first().click();

    await expect(page.getByText('No meals match "chicken".')).toBeVisible();
    await expect(page.getByText(EMPTY_LIBRARY_COPY)).toHaveCount(0);
    await expect(page.getByText("Showing 0 of 2")).toBeVisible();

    await page.getByLabel("Filter meals").fill("");
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveText(["Beef stew", "Turkey and rice"]);
  });

  test("adding an item while a filter is active keeps that card expanded (Phase 7 hasLoadedOnce)", async ({
    page,
  }) => {
    const [meal] = await seedMeals(client, user.id, ["Chicken and rice"]);
    await seedItem(client, user.id, meal.id, "Existing item", 0);
    await seedMeals(client, user.id, ["Beef stew"]);

    await logIn(page, user);
    await page.goto("/meals");
    await waitForMealsLoaded(page);
    await page.getByLabel("Filter meals").fill("chicken");
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveText(["Chicken and rice"]);

    // Items are expanded by default, so the item-management surface is already visible.
    await expect(page.getByText("Existing item")).toBeVisible();
    await page.getByRole("button", { name: "+ Add item" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Second item");
    await page.getByLabel("Total calories").fill("250");
    await page.getByLabel("Total protein (g)").fill("30");
    await page.getByRole("button", { name: "Add item", exact: true }).last().click();

    // The refresh triggered by onChanged must NOT unmount MealList (the recorded bug class), and
    // must not drop the filter.
    await expect(page.getByText("Second item")).toBeVisible();
    await expect(page.getByText("Existing item")).toBeVisible();
    await expect(page.getByLabel("Filter meals")).toHaveValue("chicken");
    await expect(page.locator(MEAL_NAME_SELECTOR)).toHaveText(["Chicken and rice"]);
  });
});

test.describe("Phase 7c - logging a saved meal still works end-to-end (Phase 7 carried forward)", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async () => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("picking a meal from the re-ordered picker logs its items into today's food entries", async ({
    page,
  }) => {
    // Seeded so the target meal is NOT first by created_at -- it only reaches its position via the
    // new shared alphabetical ordering, so a mis-wired sort would log the wrong meal.
    const seeded = await seedMeals(client, user.id, ["Zebra dinner", "Apple breakfast"]);
    const apple = seeded.find((m) => m.name === "Apple breakfast")!;
    await seedItem(client, user.id, apple.id, "Porridge", 0);
    await seedItem(client, user.id, apple.id, "Black coffee", 1);

    await logIn(page, user);
    await page.goto("/food");
    await page.getByRole("button", { name: "Log a saved meal" }).click();
    const select = page.locator("#log-meal-select");
    await expect(select).toBeVisible({ timeout: 15_000 });

    // Alphabetical order puts "Apple breakfast" first; select it by its rendered position, which
    // is exactly what a user clicking the top of the list would get.
    const firstRealOption = select.locator("option").nth(1);
    await expect(firstRealOption).toHaveText(/^Apple breakfast/);
    await select.selectOption(await firstRealOption.getAttribute("value"));
    await page.getByRole("button", { name: "Log meal" }).click();

    // Both items must land as real food_entries rows, stamped with logged_from_meal_id.
    await expect(async () => {
      const { data, error } = await client
        .from("food_entries")
        .select("name, logged_from_meal_id, consumed_at")
        .eq("logged_from_meal_id", apple.id);
      expect(error).toBeNull();
      expect((data ?? []).map((r) => r.name).sort()).toEqual(["Black coffee", "Porridge"]);
      // One shared consumed_at across the batch => still exactly one meal group.
      expect(new Set((data ?? []).map((r) => r.consumed_at)).size).toBe(1);
    }).toPass({ timeout: 15_000 });
  });
});

import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";
import { createAdminClient } from "./helpers/admin-client";
import { groupByConsumedAt } from "../src/lib/domain/entry-grouping";
import type { FoodEntry, Meal, MealItem } from "../src/lib/types";

/**
 * QA-REVIEWER independent Phase 7 acceptance suite (saved meals).
 *
 * Written from docs/architecture/food-weight-tracker.md 8 Phase 7 (In-scope list + the
 * "App-layer ownership invariant on logged_from_meal_id" callout) and its 6 scope bullets,
 * plus ai-context/DECISIONS.md "Saved meals: items scoped per-meal, logged by copying values
 * into independent food_entries rows" and "food_entries.logged_from_meal_id stays a plain FK".
 * The developer shipped no e2e coverage at all for this phase (unit tests only), so nothing here
 * is derived from an existing spec.
 *
 * Fixtures are seeded through the RLS-scoped anon client (createUserClient) -- the same client
 * shape the app itself uses -- while every assertion about what was written that needs to see
 * across users goes through the service-role admin client, so "zero rows written" means zero rows
 * anywhere, not merely zero rows visible to the caller.
 */

const SEARCH_CANDIDATE = {
  source: "usda",
  sourceId: "qa-7-1",
  name: "QA Lookup Chicken",
  quantity: 2,
  unit: "breast",
  caloriesPerUnit: 165,
  proteinGPerUnit: 31,
};

async function logIn(page: Page, user: TestUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/food");
}

type SeedItem = {
  name: string;
  quantity?: number;
  unit?: string | null;
  caloriesPerUnit: number;
  proteinGPerUnit: number;
};

/** Creates a meal + items directly (RLS-scoped), so a test can spend its UI budget on the path under test. */
async function seedMeal(
  client: SupabaseClient,
  user: TestUser,
  name: string,
  items: SeedItem[],
): Promise<{ meal: Meal; items: MealItem[] }> {
  const { data: meal, error } = await client
    .from("meals")
    .insert({ user_id: user.id, name })
    .select()
    .single();
  if (error || !meal) throw new Error(`seedMeal failed: ${error?.message}`);

  if (items.length === 0) return { meal: meal as Meal, items: [] };

  const { data: rows, error: itemsError } = await client
    .from("meal_items")
    .insert(
      items.map((item, index) => ({
        meal_id: (meal as Meal).id,
        user_id: user.id,
        name: item.name,
        quantity: item.quantity ?? 1,
        unit: item.unit ?? null,
        calories_per_unit: item.caloriesPerUnit,
        protein_g_per_unit: item.proteinGPerUnit,
        sort_order: index,
      })),
    )
    .select()
    .order("sort_order", { ascending: true });
  if (itemsError || !rows) throw new Error(`seedMeal items failed: ${itemsError?.message}`);

  return { meal: meal as Meal, items: rows as MealItem[] };
}

async function entriesForUser(userId: string): Promise<FoodEntry[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("food_entries")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`admin food_entries read failed: ${error.message}`);
  return (data ?? []) as FoodEntry[];
}

/** Every row in the whole DB back-referencing this meal, regardless of owner. */
async function entriesReferencingMeal(mealId: string): Promise<FoodEntry[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("food_entries").select("*").eq("logged_from_meal_id", mealId);
  if (error) throw new Error(`admin logged_from_meal_id read failed: ${error.message}`);
  return (data ?? []) as FoodEntry[];
}

async function itemsOfMeal(mealId: string): Promise<MealItem[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("meal_items")
    .select("*")
    .eq("meal_id", mealId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error(`admin meal_items read failed: ${error.message}`);
  return (data ?? []) as MealItem[];
}

async function openLogMealPanel(page: Page) {
  await page.goto("/food");
  await page.getByRole("button", { name: "Log a saved meal" }).click();
  await expect(page.locator("#log-meal-select")).toBeVisible();
}

/** Sets a hidden/controlled field's value straight in the DOM -- the way a hostile client would. */
async function forceFieldValue(page: Page, selector: string, value: string) {
  await page.evaluate(
    ({ sel, val }) => {
      const el = document.querySelector(sel) as HTMLInputElement | HTMLSelectElement | null;
      if (!el) throw new Error(`selector not found: ${sel}`);
      el.value = val;
    },
    { sel: selector, val: value },
  );
}

/** Injects a rogue option so a select can carry a value the server never offered. */
async function injectOption(page: Page, selector: string, value: string) {
  await page.evaluate(
    ({ sel, val }) => {
      const el = document.querySelector(sel) as HTMLSelectElement | null;
      if (!el) throw new Error(`select not found: ${sel}`);
      const option = document.createElement("option");
      option.value = val;
      option.textContent = "rogue";
      el.appendChild(option);
      el.value = val;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    { sel: selector, val: value },
  );
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// ============================================================================================
// 1. The logged_from_meal_id ownership invariant -- highest-stakes constraint in this phase
// ============================================================================================

test.describe("Phase7 QA: logged_from_meal_id ownership invariant", () => {
  let attacker: TestUser;
  let victim: TestUser;

  test.beforeEach(async ({ page }) => {
    attacker = await createConfirmedTestUser();
    victim = await createConfirmedTestUser();
    await logIn(page, attacker);
  });

  test.afterEach(async () => {
    await deleteTestUser(attacker.id);
    await deleteTestUser(victim.id);
  });

  test("logMealForDay with ANOTHER user's mealId writes zero rows and errors", async ({ page }) => {
    const victimClient = await createUserClient(victim);
    const { meal: victimMeal } = await seedMeal(victimClient, victim, "Victim Meal", [
      { name: "VictimEggs", quantity: 2, caloriesPerUnit: 70, proteinGPerUnit: 6 },
    ]);

    // The attacker needs at least one meal of their own for the dialog's form to render at all.
    const attackerClient = await createUserClient(attacker);
    await seedMeal(attackerClient, attacker, "Attacker Meal", [
      { name: "AttackerOats", caloriesPerUnit: 150, proteinGPerUnit: 5 },
    ]);

    await openLogMealPanel(page);
    await injectOption(page, "#log-meal-select", victimMeal.id);
    await page.getByRole("button", { name: "Log meal" }).click();

    // The action must reject; the panel stays open rather than closing on success.
    await expect(page.locator("#log-meal-select")).toBeVisible();

    // Direct DB verification (service-role, sees everything) -- the return value is not trusted.
    expect(await entriesReferencingMeal(victimMeal.id)).toHaveLength(0);
    expect(await entriesForUser(attacker.id)).toHaveLength(0);
    expect(await entriesForUser(victim.id)).toHaveLength(0);
  });

  test("logMealForDay with a nonexistent mealId writes zero rows", async ({ page }) => {
    const attackerClient = await createUserClient(attacker);
    await seedMeal(attackerClient, attacker, "Attacker Meal", [
      { name: "AttackerOats", caloriesPerUnit: 150, proteinGPerUnit: 5 },
    ]);

    await openLogMealPanel(page);
    await injectOption(page, "#log-meal-select", "00000000-0000-4000-8000-000000000000");
    await page.getByRole("button", { name: "Log meal" }).click();

    await expect(page.locator("#log-meal-select")).toBeVisible();
    expect(await entriesForUser(attacker.id)).toHaveLength(0);
  });

  test("every row a successful log writes carries the caller's OWN meal id", async ({ page }) => {
    const client = await createUserClient(attacker);
    const { meal } = await seedMeal(client, attacker, "Own Meal", [
      { name: "OwnA", caloriesPerUnit: 100, proteinGPerUnit: 10 },
      { name: "OwnB", quantity: 3, unit: "slice", caloriesPerUnit: 50, proteinGPerUnit: 2 },
      { name: "OwnC", caloriesPerUnit: 20, proteinGPerUnit: 1 },
    ]);

    await openLogMealPanel(page);
    await page.locator("#log-meal-select").selectOption(meal.id);
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByText("OwnA")).toBeVisible();

    const rows = await entriesForUser(attacker.id);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.logged_from_meal_id).toBe(meal.id);
      expect(row.user_id).toBe(attacker.id);
    }
  });
});

// ============================================================================================
// 2. Saved-meals CRUD driven through the real actions
// ============================================================================================

test.describe("Phase7 QA: saved-meal CRUD through the actions", () => {
  let user: TestUser;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  async function addItemViaUi(
    page: Page,
    fields: { name: string; quantity: string; calories: string; protein: string; perUnit?: boolean },
  ) {
    await page.getByRole("button", { name: "+ Add item" }).click();
    await page.getByLabel("Name", { exact: true }).fill(fields.name);
    await page.getByLabel("Quantity", { exact: true }).fill(fields.quantity);
    if (fields.perUnit) {
      await page.getByRole("radio", { name: "Per unit" }).check();
      await page.getByLabel("Calories per unit", { exact: true }).fill(fields.calories);
      await page.getByLabel("Protein per unit (g)", { exact: true }).fill(fields.protein);
    } else {
      await page.getByLabel("Total calories", { exact: true }).fill(fields.calories);
      await page.getByLabel("Total protein (g)", { exact: true }).fill(fields.protein);
    }
    await page.getByRole("button", { name: "Add item", exact: true }).click();
  }

  test("create a meal, add items, and the meal total equals the sum of its items", async ({ page }) => {
    await page.goto("/meals");
    await page.getByRole("button", { name: "+ New meal" }).click();
    await page.getByLabel("Meal name").fill("QA Breakfast");
    await page.getByRole("button", { name: "Create meal" }).click();
    await expect(page.getByText("QA Breakfast")).toBeVisible();

    // 2 units x 70 kcal / 6 g  ->  140 kcal / 12 g
    await addItemViaUi(page, { name: "Eggs", quantity: "2", calories: "70", protein: "6", perUnit: true });
    await expect(page.getByText("Eggs")).toBeVisible();
    // total mode: 200 kcal / 8 g across a quantity of 1
    await addItemViaUi(page, { name: "Toast", quantity: "1", calories: "200", protein: "8" });
    await expect(page.getByText("Toast")).toBeVisible();

    // Card summary: item count + summed calories + summed protein.
    await expect(page.getByText("2 items", { exact: false })).toContainText("340 kcal");
    await expect(page.getByText("2 items", { exact: false })).toContainText("20g protein");

    const client = await createUserClient(user);
    const { data } = await client.from("meals").select("id").eq("name", "QA Breakfast").single();
    const items = await itemsOfMeal((data as { id: string }).id);
    expect(items.map((i) => [i.name, i.calories, i.protein_g])).toEqual([
      ["Eggs", 140, 12],
      ["Toast", 200, 8],
    ]);
  });

  test("renaming a meal persists and does not disturb its items", async ({ page }) => {
    const client = await createUserClient(user);
    const { meal } = await seedMeal(client, user, "Old Name", [
      { name: "Rice", caloriesPerUnit: 200, proteinGPerUnit: 4 },
    ]);

    await page.goto("/meals");
    // Bugfix (2026-08-10): "Rename" is now an icon-only button named "Rename <meal name>" (was a
    // plain text "Rename" button) -- a prefix regex is robust to the exact meal name and matches
    // this project's established convention for icon-only-button assertions elsewhere.
    await page.getByRole("button", { name: /^Rename/ }).click();
    await page.getByLabel("Meal name").fill("New Name");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("New Name")).toBeVisible();

    const { data } = await client.from("meals").select("*").eq("id", meal.id).single();
    expect((data as Meal).name).toBe("New Name");
    const items = await itemsOfMeal(meal.id);
    expect(items).toHaveLength(1);
    expect(items[0].calories).toBe(200);
  });

  test("editing an item recalculates the meal total from the stored per-unit values", async ({ page }) => {
    const client = await createUserClient(user);
    const { meal } = await seedMeal(client, user, "Editable", [
      { name: "Chips", quantity: 3, unit: "serving", caloriesPerUnit: 100, proteinGPerUnit: 2 },
    ]);

    await page.goto("/meals");
    await expect(page.getByText("1 item", { exact: false })).toContainText("300 kcal");

    // Scoped to the item's own full aria-label ("Edit Chips") -- Phase 8f's icon-only pin toggle
    // uses aria-label={`Pin ${meal.name}`}, and this fixture's meal is literally named "Editable",
    // so an unscoped `getByRole("button", { name: "Edit" })` (substring match) would also match
    // "Pin Editable" and throw a Playwright strict-mode violation.
    await page.getByRole("button", { name: "Edit Chips" }).click();
    await page.getByLabel("Quantity", { exact: true }).fill("5");
    await page.getByRole("button", { name: "Save item" }).click();

    await expect(page.getByText("1 item", { exact: false })).toContainText("500 kcal");
    const items = await itemsOfMeal(meal.id);
    expect(items[0].quantity).toBe(5);
    expect(items[0].calories_per_unit).toBe(100);
    expect(items[0].calories).toBe(500);
  });

  test("removing an item drops it from the meal and from the total", async ({ page }) => {
    const client = await createUserClient(user);
    const { meal } = await seedMeal(client, user, "Shrinkable", [
      { name: "KeepMe", caloriesPerUnit: 100, proteinGPerUnit: 10 },
      { name: "DropMe", caloriesPerUnit: 400, proteinGPerUnit: 1 },
    ]);

    await page.goto("/meals");
    await page
      .getByRole("listitem")
      .filter({ hasText: "DropMe" })
      .getByRole("button", { name: "Delete" })
      .click();

    await expect(page.getByText("1 item", { exact: false })).toContainText("100 kcal");
    const items = await itemsOfMeal(meal.id);
    expect(items.map((i) => i.name)).toEqual(["KeepMe"]);
  });

  test("reordering items actually rewrites sort_order in the database", async ({ page }) => {
    const client = await createUserClient(user);
    const { meal } = await seedMeal(client, user, "Orderable", [
      { name: "First", caloriesPerUnit: 10, proteinGPerUnit: 1 },
      { name: "Second", caloriesPerUnit: 20, proteinGPerUnit: 2 },
      { name: "Third", caloriesPerUnit: 30, proteinGPerUnit: 3 },
    ]);

    await page.goto("/meals");
    await expect(page.getByRole("listitem")).toHaveCount(3);

    await page.getByRole("button", { name: "Move Third up" }).click();
    await expect(page.getByRole("listitem").nth(1)).toContainText("Third");

    const items = await itemsOfMeal(meal.id);
    expect(items.map((i) => i.name)).toEqual(["First", "Third", "Second"]);
    expect(items.map((i) => i.sort_order)).toEqual([0, 1, 2]);
  });

  test("deleting a meal removes it and cascades its items", async ({ page }) => {
    const client = await createUserClient(user);
    const { meal } = await seedMeal(client, user, "Doomed", [
      { name: "GoesAway1", caloriesPerUnit: 10, proteinGPerUnit: 1 },
      { name: "GoesAway2", caloriesPerUnit: 20, proteinGPerUnit: 2 },
    ]);

    await page.goto("/meals");
    page.on("dialog", (dialog) => dialog.accept());
    // Items now show by default (2026-07-30), so each item row has its own "Delete" button too --
    // the meal-level one is the first "Delete" in DOM order (card header, above the item list).
    await page.getByRole("button", { name: "Delete" }).first().click();
    await expect(page.getByText("Doomed")).toHaveCount(0);

    // RLS-scoped read: the meal is genuinely gone, not just hidden by client state.
    const { data: meals } = await client.from("meals").select("*").eq("id", meal.id);
    expect(meals ?? []).toHaveLength(0);
    // Cascade is a DB guarantee (Phase 2) -- confirm the action layer didn't fight or skip it.
    expect(await itemsOfMeal(meal.id)).toHaveLength(0);
  });
});

// ============================================================================================
// 3. logMealForDay batch semantics
// ============================================================================================

test.describe("Phase7 QA: logMealForDay batch semantics", () => {
  let user: TestUser;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("an N-item meal produces exactly N rows sharing one consumed_at/tz/local_date", async ({ page }) => {
    const client = await createUserClient(user);
    const { meal } = await seedMeal(client, user, "Batch Meal", [
      { name: "BatchA", quantity: 2, unit: "egg", caloriesPerUnit: 70, proteinGPerUnit: 6 },
      { name: "BatchB", caloriesPerUnit: 200, proteinGPerUnit: 8 },
      { name: "BatchC", quantity: 1.5, unit: "cup", caloriesPerUnit: 40, proteinGPerUnit: 3 },
    ]);

    await openLogMealPanel(page);
    await page.locator("#log-meal-select").selectOption(meal.id);
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByText("BatchA")).toBeVisible();

    const rows = await entriesForUser(user.id);
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.consumed_at)).size).toBe(1);
    expect(new Set(rows.map((r) => r.consumed_tz)).size).toBe(1);
    expect(new Set(rows.map((r) => r.consumed_local_date)).size).toBe(1);

    // Values are COPIED, not referenced: each row mirrors its source item.
    const copied = rows
      .map((r) => `${r.name}|${r.quantity}|${r.unit ?? "-"}|${r.calories_per_unit}`)
      .sort();
    expect(copied).toEqual(["BatchA|2|egg|70", "BatchB|1|-|200", "BatchC|1.5|cup|40"].sort());
  });

  test("the logged batch forms exactly one exact-timestamp group (real grouping function)", async ({ page }) => {
    const client = await createUserClient(user);
    const { meal } = await seedMeal(client, user, "Group Meal", [
      { name: "GroupA", caloriesPerUnit: 100, proteinGPerUnit: 5 },
      { name: "GroupB", caloriesPerUnit: 100, proteinGPerUnit: 5 },
      { name: "GroupC", caloriesPerUnit: 100, proteinGPerUnit: 5 },
    ]);

    await openLogMealPanel(page);
    await page.locator("#log-meal-select").selectOption(meal.id);
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByText("GroupA")).toBeVisible();

    const rows = await entriesForUser(user.id);
    const groups = groupByConsumedAt(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toHaveLength(3);

    // ...and the UI renders it as one group section too.
    await expect(page.locator("section")).toHaveCount(1);
  });

  test("the day's daily_food_totals reflects the whole batch", async ({ page }) => {
    const client = await createUserClient(user);
    const { meal } = await seedMeal(client, user, "Totals Meal", [
      { name: "SumItemOne", quantity: 2, caloriesPerUnit: 150, proteinGPerUnit: 10 },
      { name: "SumItemTwo", caloriesPerUnit: 250, proteinGPerUnit: 5 },
    ]);

    await openLogMealPanel(page);
    await page.locator("#log-meal-select").selectOption(meal.id);
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByText("SumItemOne")).toBeVisible();

    const rows = await entriesForUser(user.id);
    const day = rows[0].consumed_local_date;
    const { data, error } = await client
      .from("daily_food_totals")
      .select("*")
      .eq("consumed_local_date", day)
      .single();
    if (error) throw new Error(`daily_food_totals read failed: ${error.message}`);
    const totals = data as { total_calories: number; total_protein_g: number };
    expect(Number(totals.total_calories)).toBe(550);
    expect(Number(totals.total_protein_g)).toBe(25);
  });

  test("logging the same meal at two different times yields two separate groups", async ({ page }) => {
    const client = await createUserClient(user);
    const { meal } = await seedMeal(client, user, "Twice Meal", [
      { name: "TwiceA", caloriesPerUnit: 100, proteinGPerUnit: 5 },
      { name: "TwiceB", caloriesPerUnit: 100, proteinGPerUnit: 5 },
    ]);

    await openLogMealPanel(page);
    await page.locator("#log-meal-select").selectOption(meal.id);
    await page.locator("#log-meal-time").selectOption("08:00");
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByText("TwiceA")).toBeVisible();

    await page.getByRole("button", { name: "Log a saved meal" }).click();
    await page.locator("#log-meal-select").selectOption(meal.id);
    await page.locator("#log-meal-time").selectOption("12:30");
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByRole("listitem").filter({ hasText: "TwiceA" })).toHaveCount(2);

    const rows = await entriesForUser(user.id);
    expect(rows).toHaveLength(4);
    const groups = groupByConsumedAt(rows);
    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.entries.length)).toEqual([2, 2]);
  });
});

// ============================================================================================
// 4. Empty meal rejected (server-side, not just a UI affordance)
// ============================================================================================

test.describe("Phase7 QA: empty meal rejected", () => {
  let user: TestUser;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("logging a meal with zero items is rejected and writes no rows", async ({ page }) => {
    const client = await createUserClient(user);
    const { meal } = await seedMeal(client, user, "Hollow Meal", []);

    await openLogMealPanel(page);
    await page.locator("#log-meal-select").selectOption(meal.id);
    await page.getByRole("button", { name: "Log meal" }).click();

    await expect(page.getByText("That meal has no items yet")).toBeVisible();
    expect(await entriesForUser(user.id)).toHaveLength(0);
    expect(await entriesReferencingMeal(meal.id)).toHaveLength(0);
  });

  test("the same meal logs fine once it has an item (the rejection is not blanket)", async ({ page }) => {
    const client = await createUserClient(user);
    const { meal } = await seedMeal(client, user, "Fillable Meal", []);

    await openLogMealPanel(page);
    await page.locator("#log-meal-select").selectOption(meal.id);
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByText("That meal has no items yet")).toBeVisible();

    await client.from("meal_items").insert({
      meal_id: meal.id,
      user_id: user.id,
      name: "NowFilled",
      quantity: 1,
      calories_per_unit: 120,
      protein_g_per_unit: 9,
      sort_order: 0,
    });

    await openLogMealPanel(page);
    await page.locator("#log-meal-select").selectOption(meal.id);
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByText("NowFilled")).toBeVisible();
    expect(await entriesForUser(user.id)).toHaveLength(1);
  });
});

// ============================================================================================
// 5. Copy-by-value: meal edits/deletes never touch already-logged history
// ============================================================================================

test.describe("Phase7 QA: meal edits never rewrite logged history", () => {
  let user: TestUser;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  async function logSeededMeal(page: Page, mealId: string, firstItemName: string) {
    await openLogMealPanel(page);
    await page.locator("#log-meal-select").selectOption(mealId);
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByText(firstItemName)).toBeVisible();
    return entriesForUser(user.id);
  }

  function snapshot(rows: FoodEntry[]) {
    return rows
      .map((r) =>
        [
          r.id,
          r.name,
          r.quantity,
          r.unit ?? "-",
          r.calories_per_unit,
          r.protein_g_per_unit,
          r.calories,
          r.protein_g,
          r.consumed_at,
          r.consumed_tz,
          r.consumed_local_date,
        ].join("|"),
      )
      .sort();
  }

  test("editing an item's calories after logging leaves the logged rows untouched", async ({ page }) => {
    const client = await createUserClient(user);
    const { meal } = await seedMeal(client, user, "History Meal", [
      { name: "HistA", quantity: 2, unit: "egg", caloriesPerUnit: 70, proteinGPerUnit: 6 },
      { name: "HistB", caloriesPerUnit: 200, proteinGPerUnit: 8 },
    ]);

    const before = snapshot(await logSeededMeal(page, meal.id, "HistA"));
    expect(before).toHaveLength(2);

    await page.goto("/meals");
    await page
      .getByRole("listitem")
      .filter({ hasText: "HistA" })
      .getByRole("button", { name: "Edit" })
      .click();
    await page.getByLabel("Calories per unit", { exact: true }).fill("999");
    await page.getByRole("button", { name: "Save item" }).click();
    await expect(page.getByText("2 items", { exact: false })).toContainText("2198 kcal");

    expect(snapshot(await entriesForUser(user.id))).toEqual(before);
  });

  test("deleting an item after logging leaves the logged rows untouched", async ({ page }) => {
    const client = await createUserClient(user);
    const { meal } = await seedMeal(client, user, "Prune Meal", [
      { name: "PruneA", caloriesPerUnit: 100, proteinGPerUnit: 5 },
      { name: "PruneB", caloriesPerUnit: 300, proteinGPerUnit: 15 },
    ]);

    const before = snapshot(await logSeededMeal(page, meal.id, "PruneA"));

    await page.goto("/meals");
    await page
      .getByRole("listitem")
      .filter({ hasText: "PruneB" })
      .getByRole("button", { name: "Delete" })
      .click();
    await expect(page.getByText("1 item", { exact: false })).toContainText("100 kcal");

    const after = await entriesForUser(user.id);
    expect(after).toHaveLength(2);
    expect(snapshot(after)).toEqual(before);
  });

  test("deleting the whole meal leaves the logged rows' values intact (only the back-reference clears)", async ({
    page,
  }) => {
    const client = await createUserClient(user);
    const { meal } = await seedMeal(client, user, "Vanishing Meal", [
      { name: "VanA", quantity: 3, unit: "slice", caloriesPerUnit: 80, proteinGPerUnit: 3 },
      { name: "VanB", caloriesPerUnit: 150, proteinGPerUnit: 12 },
    ]);

    const logged = await logSeededMeal(page, meal.id, "VanA");
    const before = snapshot(logged);
    for (const row of logged) expect(row.logged_from_meal_id).toBe(meal.id);

    await page.goto("/meals");
    page.on("dialog", (dialog) => dialog.accept());
    // Items now show by default (2026-07-30), so each item row has its own "Delete" button too --
    // the meal-level one is the first "Delete" in DOM order (card header, above the item list).
    await page.getByRole("button", { name: "Delete" }).first().click();
    await expect(page.getByText("Vanishing Meal")).toHaveCount(0);

    const after = await entriesForUser(user.id);
    expect(after).toHaveLength(2);
    expect(snapshot(after)).toEqual(before);
    // ON DELETE SET NULL is the documented, intended behaviour for the back-reference only.
    for (const row of after) expect(row.logged_from_meal_id).toBeNull();

    // And the history still renders on /food.
    await page.goto("/food");
    await expect(page.getByText("VanA")).toBeVisible();
    await expect(page.getByText("VanB")).toBeVisible();
  });
});

// ============================================================================================
// 6. Future-day cap on the whole batch
// ============================================================================================

test.describe("Phase7 QA: future-day cap on the batch", () => {
  let user: TestUser;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("logging a meal dated tomorrow is rejected server-side with zero rows written", async ({ page }) => {
    const client = await createUserClient(user);
    const { meal } = await seedMeal(client, user, "Future Meal", [
      { name: "FutureA", caloriesPerUnit: 100, proteinGPerUnit: 5 },
      { name: "FutureB", caloriesPerUnit: 100, proteinGPerUnit: 5 },
    ]);

    await openLogMealPanel(page);
    await page.locator("#log-meal-select").selectOption(meal.id);
    // Bypass the client-side max=today exactly as a hostile client would.
    await forceFieldValue(page, "#log-meal-date", localTomorrow());
    await page.getByRole("button", { name: "Log meal" }).click();

    await expect(page.getByText("You can't log a meal dated later than today")).toBeVisible();
    expect(await entriesForUser(user.id)).toHaveLength(0);
    expect(await entriesReferencingMeal(meal.id)).toHaveLength(0);
  });

  test("logging the same meal for today succeeds (the cap is a day cap, not a blanket block)", async ({ page }) => {
    const client = await createUserClient(user);
    const { meal } = await seedMeal(client, user, "Today Meal", [
      { name: "TodayA", caloriesPerUnit: 100, proteinGPerUnit: 5 },
    ]);

    await openLogMealPanel(page);
    await page.locator("#log-meal-select").selectOption(meal.id);
    await forceFieldValue(page, "#log-meal-date", localToday());
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByText("TodayA")).toBeVisible();

    expect(await entriesForUser(user.id)).toHaveLength(1);
  });
});

// ============================================================================================
// 7. RLS re-verified through the new action surface
// ============================================================================================

test.describe("Phase7 QA: RLS through the meals action surface", () => {
  let attacker: TestUser;
  let victim: TestUser;
  let victimMeal: Meal;

  test.beforeEach(async ({ page }) => {
    attacker = await createConfirmedTestUser();
    victim = await createConfirmedTestUser();
    const victimClient = await createUserClient(victim);
    const seeded = await seedMeal(victimClient, victim, "Victim Meal", [
      { name: "VictimItem", quantity: 2, unit: "cup", caloriesPerUnit: 90, proteinGPerUnit: 4 },
    ]);
    victimMeal = seeded.meal;

    const attackerClient = await createUserClient(attacker);
    await seedMeal(attackerClient, attacker, "Attacker Meal", [
      { name: "AttackerItem", caloriesPerUnit: 10, proteinGPerUnit: 1 },
    ]);
    await logIn(page, attacker);
  });

  test.afterEach(async () => {
    await deleteTestUser(attacker.id);
    await deleteTestUser(victim.id);
  });

  test("meals page lists only the caller's own meals", async ({ page }) => {
    await page.goto("/meals");
    await expect(page.getByText("Attacker Meal")).toBeVisible();
    await expect(page.getByText("Victim Meal")).toHaveCount(0);
    await expect(page.getByText("VictimItem")).toHaveCount(0);
  });

  test("updateMeal cannot rename another user's meal", async ({ page }) => {
    await page.goto("/meals");
    // Bugfix (2026-08-10): "Rename" is now an icon-only button named "Rename <meal name>" (was a
    // plain text "Rename" button) -- a prefix regex is robust to the exact meal name and matches
    // this project's established convention for icon-only-button assertions elsewhere.
    await page.getByRole("button", { name: /^Rename/ }).click();
    await page.getByLabel("Meal name").fill("Pwned");
    await forceFieldValue(page, 'input[type="hidden"][name="id"]', victimMeal.id);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForTimeout(1500);

    const admin = createAdminClient();
    const { data } = await admin.from("meals").select("name").eq("id", victimMeal.id).single();
    expect((data as { name: string }).name).toBe("Victim Meal");
    await expect(page.getByText("Pwned")).toHaveCount(0);
  });
});

test.describe("Phase7 QA: RLS through the meal-item action surface", () => {
  let attacker: TestUser;
  let victim: TestUser;
  let victimMeal: Meal;
  let victimItems: MealItem[];

  test.beforeEach(async ({ page }) => {
    attacker = await createConfirmedTestUser();
    victim = await createConfirmedTestUser();
    const victimClient = await createUserClient(victim);
    const seeded = await seedMeal(victimClient, victim, "Victim Meal", [
      { name: "VictimItem", quantity: 2, unit: "cup", caloriesPerUnit: 90, proteinGPerUnit: 4 },
    ]);
    victimMeal = seeded.meal;
    victimItems = seeded.items;

    const attackerClient = await createUserClient(attacker);
    await seedMeal(attackerClient, attacker, "Attacker Meal", [
      { name: "AttackerItem", caloriesPerUnit: 10, proteinGPerUnit: 1 },
    ]);
    await logIn(page, attacker);
  });

  test.afterEach(async () => {
    await deleteTestUser(attacker.id);
    await deleteTestUser(victim.id);
  });

  test("addMealItem cannot add an item to another user's meal", async ({ page }) => {
    await page.goto("/meals");
    await page.getByRole("button", { name: "+ Add item" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Injected");
    await page.getByLabel("Total calories", { exact: true }).fill("500");
    await page.getByLabel("Total protein (g)", { exact: true }).fill("50");
    await forceFieldValue(page, 'input[type="hidden"][name="mealId"]', victimMeal.id);
    await page.getByRole("button", { name: "Add item", exact: true }).click();
    await page.waitForTimeout(1500);

    const victimNow = await itemsOfMeal(victimMeal.id);
    expect(victimNow.map((i) => i.name)).toEqual(["VictimItem"]);

    const admin = createAdminClient();
    const { data } = await admin.from("meal_items").select("*").eq("user_id", attacker.id);
    expect((data as MealItem[]).map((i) => i.name)).toEqual(["AttackerItem"]);
  });

  test("updateMealItem cannot edit another user's meal item", async ({ page }) => {
    await page.goto("/meals");
    await page.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Name", { exact: true }).fill("Hijacked");
    await forceFieldValue(page, 'input[type="hidden"][name="id"]', victimItems[0].id);
    await page.getByRole("button", { name: "Save item" }).click();
    await page.waitForTimeout(1500);

    const victimNow = await itemsOfMeal(victimMeal.id);
    expect(victimNow[0].name).toBe("VictimItem");
    expect(victimNow[0].calories_per_unit).toBe(90);
    expect(victimNow[0].quantity).toBe(2);
  });
});

// ============================================================================================
// 8. MealList local UI state survives the post-mutation refresh (the hasLoadedOnce fix)
// ============================================================================================

test.describe("Phase7 QA: expanded meal state survives a post-mutation refresh", () => {
  let user: TestUser;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("adding an item keeps the meal card expanded (no unmount/collapse)", async ({ page }) => {
    const client = await createUserClient(user);
    await seedMeal(client, user, "Sticky Meal", [
      { name: "StickyA", caloriesPerUnit: 100, proteinGPerUnit: 5 },
    ]);

    await page.goto("/meals");
    // Bugfix (2026-08-10): the expand/collapse control is now an icon-only chevron named
    // "Hide items for <meal name>"/"Show items for <meal name>" (was a plain "Hide items"/"Manage
    // items" text button) -- prefix regex, robust to the exact meal name.
    await expect(page.getByRole("button", { name: /^Hide items/ })).toBeVisible();

    await page.getByRole("button", { name: "+ Add item" }).click();
    await page.getByLabel("Name", { exact: true }).fill("StickyB");
    await page.getByLabel("Total calories", { exact: true }).fill("250");
    await page.getByLabel("Total protein (g)", { exact: true }).fill("20");
    await page.getByRole("button", { name: "Add item", exact: true }).click();

    await expect(page.getByText("StickyB")).toBeVisible();
    // Bugfix (2026-08-10): the expand/collapse control is now an icon-only chevron named
    // "Hide items for <meal name>"/"Show items for <meal name>" (was a plain "Hide items"/"Manage
    // items" text button) -- prefix regex, robust to the exact meal name.
    await expect(page.getByRole("button", { name: /^Hide items/ })).toBeVisible();
    await expect(page.getByRole("listitem")).toHaveCount(2);
    await expect(page.getByText("Loading", { exact: false })).toHaveCount(0);
  });

  test("deleting an item keeps the meal card expanded", async ({ page }) => {
    const client = await createUserClient(user);
    await seedMeal(client, user, "Sticky Meal 2", [
      { name: "KeepA", caloriesPerUnit: 100, proteinGPerUnit: 5 },
      { name: "RemoveB", caloriesPerUnit: 100, proteinGPerUnit: 5 },
    ]);

    await page.goto("/meals");
    await page
      .getByRole("listitem")
      .filter({ hasText: "RemoveB" })
      .getByRole("button", { name: "Delete" })
      .click();

    await expect(page.getByRole("listitem")).toHaveCount(1);
    // Bugfix (2026-08-10): the expand/collapse control is now an icon-only chevron named
    // "Hide items for <meal name>"/"Show items for <meal name>" (was a plain "Hide items"/"Manage
    // items" text button) -- prefix regex, robust to the exact meal name.
    await expect(page.getByRole("button", { name: /^Hide items/ })).toBeVisible();
    await expect(page.getByText("Loading", { exact: false })).toHaveCount(0);
  });

  test("renaming a meal keeps the card expanded and the item list rendered", async ({ page }) => {
    const client = await createUserClient(user);
    await seedMeal(client, user, "Renamable Meal", [
      { name: "RenA", caloriesPerUnit: 100, proteinGPerUnit: 5 },
    ]);

    await page.goto("/meals");
    // Bugfix (2026-08-10): "Rename" is now an icon-only button named "Rename <meal name>" (was a
    // plain text "Rename" button) -- a prefix regex is robust to the exact meal name and matches
    // this project's established convention for icon-only-button assertions elsewhere.
    await page.getByRole("button", { name: /^Rename/ }).click();
    await page.getByLabel("Meal name").fill("Renamed Meal");
    await page.getByRole("button", { name: "Save", exact: true }).click();

    await expect(page.getByText("Renamed Meal")).toBeVisible();
    // Bugfix (2026-08-10): the expand/collapse control is now an icon-only chevron named
    // "Hide items for <meal name>"/"Show items for <meal name>" (was a plain "Hide items"/"Manage
    // items" text button) -- prefix regex, robust to the exact meal name.
    await expect(page.getByRole("button", { name: /^Hide items/ })).toBeVisible();
    await expect(page.getByText("RenA", { exact: true })).toBeVisible();
  });
});

// ============================================================================================
// 9. Reused Phase 6 lookup panel inside MealItemForm (prefill only, never auto-submit)
// ============================================================================================

test.describe("Phase7 QA: FoodLookupPanel reuse inside MealItemForm", () => {
  let user: TestUser;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await page.route("**/api/lookup/search**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ candidates: [SEARCH_CANDIDATE] }),
      }),
    );
    await logIn(page, user);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("picking a candidate prefills the item fields and never auto-submits", async ({ page }) => {
    const client = await createUserClient(user);
    const { meal } = await seedMeal(client, user, "Lookup Meal", []);

    await page.goto("/meals");
    await page.getByRole("button", { name: "+ Add item" }).click();
    await page.getByRole("button", { name: "Look up a food (barcode or search)" }).click();
    await page.getByLabel("Search by description").fill("chicken");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByRole("button", { name: "Use this" }).click();

    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("QA Lookup Chicken");
    await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("2");
    await expect(page.getByLabel("Unit (optional)", { exact: true })).toHaveValue("breast");
    await expect(page.getByLabel("Calories per unit", { exact: true })).toHaveValue("165");
    await expect(page.getByLabel("Protein per unit (g)", { exact: true })).toHaveValue("31");

    expect(await itemsOfMeal(meal.id)).toHaveLength(0);

    await page.getByRole("button", { name: "Add item", exact: true }).click();
    await expect(page.getByText("QA Lookup Chicken")).toBeVisible();

    const items = await itemsOfMeal(meal.id);
    expect(items).toHaveLength(1);
    expect(items[0].quantity).toBe(2);
    expect(items[0].unit).toBe("breast");
    expect(items[0].calories_per_unit).toBe(165);
    expect(items[0].calories).toBe(330);
    expect(items[0].protein_g).toBe(62);
  });

  test("the lookup panel is offered on add but not on edit (parity with FoodEntryForm)", async ({ page }) => {
    const client = await createUserClient(user);
    await seedMeal(client, user, "Edit Lookup Meal", [
      { name: "AlreadySaved", caloriesPerUnit: 100, proteinGPerUnit: 5 },
    ]);

    await page.goto("/meals");
    await page.getByRole("button", { name: "+ Add item" }).click();
    await expect(page.getByRole("button", { name: "Look up a food (barcode or search)" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();

    // Scoped to the item's own full aria-label ("Edit AlreadySaved") -- this fixture's meal is
    // named "Edit Lookup Meal", so the pin toggle's `aria-label="Pin Edit Lookup Meal"` would also
    // match an unscoped substring `getByRole("button", { name: "Edit" })` (see the identical note
    // above in "editing an item recalculates the meal total...").
    await page.getByRole("button", { name: "Edit AlreadySaved" }).click();
    await expect(page.getByRole("button", { name: "Look up a food (barcode or search)" })).toHaveCount(0);
  });
});

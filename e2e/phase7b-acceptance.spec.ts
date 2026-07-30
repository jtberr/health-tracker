import { execFileSync } from "node:child_process";
import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";
import { createAdminClient } from "./helpers/admin-client";
import type { FoodEntry, Meal, MealItem } from "../src/lib/types";

/**
 * QA-REVIEWER independent Phase 7b acceptance suite -- "Save a logged meal group as a Saved Meal".
 *
 * Written from docs/architecture/food-weight-tracker.md 6's "Save a logged group as a Saved Meal"
 * block, 3.3 (createMealFromEntries semantics), 3.4 (inline expander + blank name field + the
 * hasLoadedOnce prerequisite), 5 (accepted residual empty-meal risk; the explicitly out-of-scope
 * advisory note), and 8 Phase 7b's In/Out scope -- NOT from the developer's own test files.
 *
 * Everything drives the REAL Server Action through the REAL browser form, so ownership checks are
 * exercised across the actual Next.js Server Action boundary rather than a mocked createClient.
 * Fixtures are seeded via the RLS-scoped anon client; every "was anything written?" assertion goes
 * through the service-role admin client, so "zero rows" means zero rows ANYWHERE (the Phase 7
 * evidentiary bar), not merely zero rows visible to the caller.
 *
 * The browser is pinned to UTC so "today" is deterministic and no Day-input navigation is needed
 * (deliberately sidestepping the documented pre-existing FoodDayView Day-input race).
 */

test.use({ timezoneId: "UTC" });

async function logIn(page: Page, user: TestUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
}

/** An instant `minutesAgo` in the past, clamped to stay inside today's UTC day. */
function pastInstant(minutesAgo: number): string {
  const now = Date.now();
  const d = new Date(now);
  const startOfUtcDay = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return new Date(Math.max(now - minutesAgo * 60_000, startOfUtcDay + 1000)).toISOString();
}

type SeedEntry = {
  name: string;
  quantity?: number;
  unit?: string | null;
  caloriesPerUnit: number;
  proteinGPerUnit: number;
  consumedAt: string;
  loggedFromMealId?: string | null;
};

/**
 * Inserts entries ONE STATEMENT AT A TIME on purpose: Postgres' now() is stable for a whole
 * statement, so a single multi-row insert would give every row an identical created_at and make
 * any ordering assertion meaningless (real logging is one request per entry).
 */
async function seedEntries(
  client: SupabaseClient,
  user: TestUser,
  rows: SeedEntry[],
): Promise<FoodEntry[]> {
  const out: FoodEntry[] = [];
  for (const row of rows) {
    const { data, error } = await client
      .from("food_entries")
      .insert({
        user_id: user.id,
        name: row.name,
        quantity: row.quantity ?? 1,
        unit: row.unit ?? null,
        calories_per_unit: row.caloriesPerUnit,
        protein_g_per_unit: row.proteinGPerUnit,
        consumed_at: row.consumedAt,
        consumed_tz: "UTC",
        logged_from_meal_id: row.loggedFromMealId ?? null,
      })
      .select()
      .single();
    if (error || !data) throw new Error(`seedEntries failed: ${error?.message}`);
    out.push(data as FoodEntry);
  }
  return out;
}

async function seedMeal(
  client: SupabaseClient,
  user: TestUser,
  name: string,
  items: { name: string; quantity?: number; unit?: string | null; caloriesPerUnit: number; proteinGPerUnit: number }[],
): Promise<Meal> {
  const { data: meal, error } = await client.from("meals").insert({ user_id: user.id, name }).select().single();
  if (error || !meal) throw new Error(`seedMeal failed: ${error?.message}`);
  if (items.length > 0) {
    const { error: itemsError } = await client.from("meal_items").insert(
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
    );
    if (itemsError) throw new Error(`seedMeal items failed: ${itemsError.message}`);
  }
  return meal as Meal;
}

async function mealsForUser(userId: string): Promise<Meal[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("meals").select("*").eq("user_id", userId).order("created_at", { ascending: true });
  if (error) throw new Error(`admin meals read failed: ${error.message}`);
  return (data ?? []) as Meal[];
}

async function itemsOfMeal(mealId: string): Promise<MealItem[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("meal_items").select("*").eq("meal_id", mealId).order("sort_order", { ascending: true });
  if (error) throw new Error(`admin meal_items read failed: ${error.message}`);
  return (data ?? []) as MealItem[];
}

async function itemsForUser(userId: string): Promise<MealItem[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("meal_items").select("*").eq("user_id", userId);
  if (error) throw new Error(`admin meal_items read failed: ${error.message}`);
  return (data ?? []) as MealItem[];
}

async function entriesForUser(userId: string): Promise<FoodEntry[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("food_entries").select("*").eq("user_id", userId).order("created_at", { ascending: true });
  if (error) throw new Error(`admin food_entries read failed: ${error.message}`);
  return (data ?? []) as FoodEntry[];
}

/** Opens the "Save as meal" expander on the group containing `anchorText`. */
async function openSaveAsMeal(page: Page, anchorText: string) {
  const group = page.locator("section", { hasText: anchorText });
  await expect(group).toBeVisible();
  await group.getByRole("button", { name: "Save as meal" }).click();
  await expect(group.getByLabel("Meal name")).toBeVisible();
  return group;
}

/** Replaces the dialog's hidden entryIds inputs with an arbitrary set -- as a hostile client would. */
async function forceEntryIds(page: Page, ids: string[]) {
  await page.evaluate((newIds: string[]) => {
    const existing = Array.from(document.querySelectorAll('input[name="entryIds"]')) as HTMLInputElement[];
    const form = existing[0]?.form;
    if (!form) throw new Error("save-as-meal form not found");
    for (const el of existing) el.remove();
    for (const id of newIds) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = "entryIds";
      input.value = id;
      form.appendChild(input);
    }
  }, ids);
}

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "supabase_db_health-tracker", "psql", "-U", "postgres", "-d", "postgres", "-c", sql],
    { encoding: "utf8" },
  );
}

// =============================================================================================
// 1. Faithful copy: values, order, and the generated-total invariant
// =============================================================================================

test.describe("Phase7b QA: faithful copy-by-value", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
  });
  test.afterEach(async () => { await deleteTestUser(user.id); });

  test("a 3-entry group produces one meal with exactly 3 matching items, in logged order", async ({ page }) => {
    const at = pastInstant(30);
    await seedEntries(client, user, [
      { name: "QA Eggs", quantity: 3, unit: "egg", caloriesPerUnit: 78, proteinGPerUnit: 6.3, consumedAt: at },
      { name: "QA Toast", quantity: 2, unit: "slice", caloriesPerUnit: 90, proteinGPerUnit: 3.1, consumedAt: at },
      { name: "QA Coffee", quantity: 1, unit: null, caloriesPerUnit: 5, proteinGPerUnit: 0.3, consumedAt: at },
    ]);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA Eggs");
    await group.getByLabel("Meal name").fill("QA Weekday breakfast");
    await group.getByRole("button", { name: "Save meal" }).click();
    await expect(page.getByText('Saved as "QA Weekday breakfast".')).toBeVisible();

    const meals = await mealsForUser(user.id);
    expect(meals).toHaveLength(1);
    expect(meals[0].name).toBe("QA Weekday breakfast");

    const items = await itemsOfMeal(meals[0].id);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.name)).toEqual(["QA Eggs", "QA Toast", "QA Coffee"]);
    expect(items.map((i) => i.sort_order)).toEqual([0, 1, 2]);
    expect(items.map((i) => Number(i.quantity))).toEqual([3, 2, 1]);
    expect(items.map((i) => i.unit)).toEqual(["egg", "slice", null]);
    expect(items.map((i) => Number(i.calories_per_unit))).toEqual([78, 90, 5]);
    expect(items.map((i) => Number(i.protein_g_per_unit))).toEqual([6.3, 3.1, 0.3]);
    for (const item of items) {
      expect(item.user_id).toBe(user.id);
      expect(item.meal_id).toBe(meals[0].id);
    }
  });

  test("the meal's summed totals equal the source group's summed totals exactly", async ({ page }) => {
    const at = pastInstant(25);
    // quantity x per-unit deliberately does NOT land on integers, to catch any "copy the total
    // across" shortcut (which would round differently from the generated column).
    const sources = await seedEntries(client, user, [
      { name: "QA Rice", quantity: 1.75, unit: "cup", caloriesPerUnit: 205.33, proteinGPerUnit: 4.27, consumedAt: at },
      { name: "QA Chicken", quantity: 2.5, unit: "breast", caloriesPerUnit: 165.55, proteinGPerUnit: 31.09, consumedAt: at },
    ]);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA Rice");
    await group.getByLabel("Meal name").fill("QA Totals");
    await group.getByRole("button", { name: "Save meal" }).click();
    await expect(page.getByText('Saved as "QA Totals".')).toBeVisible();

    const meals = await mealsForUser(user.id);
    const items = await itemsOfMeal(meals[0].id);

    const srcCalories = sources.reduce((s, e) => s + Number(e.calories), 0);
    const srcProtein = sources.reduce((s, e) => s + Number(e.protein_g), 0);
    expect(items.reduce((s, i) => s + Number(i.calories), 0)).toBe(srcCalories);
    expect(items.reduce((s, i) => s + Number(i.protein_g), 0)).toBeCloseTo(srcProtein, 10);
    // ...and per-row, proving both sides ran the SAME generated expression rather than a copy.
    expect(items.map((i) => Number(i.calories))).toEqual(sources.map((e) => Number(e.calories)));
    expect(items.map((i) => Number(i.protein_g))).toEqual(sources.map((e) => Number(e.protein_g)));
  });

  test("a one-entry group saves as a valid one-item meal that logMealForDay accepts", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA Solo Bar", quantity: 1, unit: "bar", caloriesPerUnit: 210, proteinGPerUnit: 20, consumedAt: pastInstant(20) },
    ]);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA Solo Bar");
    await group.getByLabel("Meal name").fill("QA Solo Meal");
    await group.getByRole("button", { name: "Save meal" }).click();
    await expect(page.getByText('Saved as "QA Solo Meal".')).toBeVisible();

    const meals = await mealsForUser(user.id);
    expect(await itemsOfMeal(meals[0].id)).toHaveLength(1);

    // Now log it -- the empty_meal rejection must NOT catch a one-item meal.
    await page.reload();
    await page.getByRole("button", { name: "Log a saved meal" }).click();
    await page.locator("#log-meal-select").selectOption(meals[0].id);
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByText("Meal logged.")).toBeVisible();

    const logged = (await entriesForUser(user.id)).filter((e) => e.logged_from_meal_id === meals[0].id);
    expect(logged).toHaveLength(1);
    expect(logged[0].name).toBe("QA Solo Bar");
  });

  test("round-trip: save a group, log the new meal, and the batch reproduces it as one group", async ({ page }) => {
    const at = pastInstant(40);
    const sources = await seedEntries(client, user, [
      { name: "QA RT A", quantity: 2, unit: "scoop", caloriesPerUnit: 120, proteinGPerUnit: 24, consumedAt: at },
      { name: "QA RT B", quantity: 1, unit: "banana", caloriesPerUnit: 105, proteinGPerUnit: 1.3, consumedAt: at },
    ]);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA RT A");
    await group.getByLabel("Meal name").fill("QA Round Trip");
    await group.getByRole("button", { name: "Save meal" }).click();
    await expect(page.getByText('Saved as "QA Round Trip".')).toBeVisible();

    const meals = await mealsForUser(user.id);
    await page.reload();
    await page.getByRole("button", { name: "Log a saved meal" }).click();
    await page.locator("#log-meal-select").selectOption(meals[0].id);
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByText("Meal logged.")).toBeVisible();

    const logged = (await entriesForUser(user.id)).filter((e) => e.logged_from_meal_id === meals[0].id);
    expect(logged).toHaveLength(2);
    expect(new Set(logged.map((e) => e.consumed_at)).size).toBe(1); // one exact-timestamp group
    expect(logged.map((e) => e.name).sort()).toEqual(["QA RT A", "QA RT B"]);
    expect(logged.reduce((s, e) => s + Number(e.calories), 0)).toBe(
      sources.reduce((s, e) => s + Number(e.calories), 0),
    );
  });
});

// =============================================================================================
// 2. THE load-bearing one: source food_entries are untouched
// =============================================================================================

test.describe("Phase7b QA: strictly read-only on food_entries", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
  });
  test.afterEach(async () => { await deleteTestUser(user.id); });

  test("source rows are byte-identical after the save, incl. updated_at and logged_from_meal_id", async ({ page }) => {
    const at = pastInstant(35);
    await seedEntries(client, user, [
      { name: "QA RO A", quantity: 2, unit: "cup", caloriesPerUnit: 60, proteinGPerUnit: 2, consumedAt: at },
      { name: "QA RO B", quantity: 1, unit: null, caloriesPerUnit: 300, proteinGPerUnit: 12, consumedAt: at },
    ]);
    const before = await entriesForUser(user.id);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA RO A");
    await group.getByLabel("Meal name").fill("QA ReadOnly");
    await group.getByRole("button", { name: "Save meal" }).click();
    await expect(page.getByText('Saved as "QA ReadOnly".')).toBeVisible();

    const after = await entriesForUser(user.id);
    // Full-row deep equality -- catches ANY update, not just fields we thought to name.
    expect(after).toEqual(before);
    expect(after.map((e) => e.updated_at)).toEqual(before.map((e) => e.updated_at));
    expect(after.map((e) => e.logged_from_meal_id)).toEqual(before.map((e) => e.logged_from_meal_id));
    expect(after.every((e) => e.logged_from_meal_id === null)).toBe(true);
  });

  test("a group already logged FROM a meal keeps its back-reference and badge (no relink)", async ({ page }) => {
    const meal = await seedMeal(client, user, "QA Origin Meal", [
      { name: "QA Origin Item", quantity: 2, unit: "piece", caloriesPerUnit: 55, proteinGPerUnit: 4 },
    ]);
    await seedEntries(client, user, [
      { name: "QA Origin Item", quantity: 2, unit: "piece", caloriesPerUnit: 55, proteinGPerUnit: 4, consumedAt: pastInstant(45), loggedFromMealId: meal.id },
    ]);
    const before = await entriesForUser(user.id);

    await page.goto("/food");
    await expect(page.getByText("From a saved meal")).toBeVisible();
    const group = await openSaveAsMeal(page, "QA Origin Item");
    await group.getByLabel("Meal name").fill("QA Cloned Meal");
    await group.getByRole("button", { name: "Save meal" }).click();
    await expect(page.getByText('Saved as "QA Cloned Meal".')).toBeVisible();

    const after = await entriesForUser(user.id);
    expect(after).toEqual(before);
    expect(after[0].logged_from_meal_id).toBe(meal.id); // still the ORIGINAL meal, not the clone

    const meals = await mealsForUser(user.id);
    expect(meals).toHaveLength(2);
    const clone = meals.find((m) => m.name === "QA Cloned Meal")!;
    const origin = meals.find((m) => m.name === "QA Origin Meal")!;
    expect(clone.id).not.toBe(origin.id);
    expect(origin.updated_at).toBe(meal.updated_at); // original meal row untouched

    // No reference chain between the two meals: the clone's items are plain value copies.
    const cloneItems = await itemsOfMeal(clone.id);
    const originItems = await itemsOfMeal(origin.id);
    expect(cloneItems).toHaveLength(1);
    expect(cloneItems[0].id).not.toBe(originItems[0].id);
    expect(cloneItems[0].name).toBe(originItems[0].name);
    expect(Number(cloneItems[0].calories)).toBe(Number(originItems[0].calories));

    await expect(page.getByText("From a saved meal")).toBeVisible(); // badge reads as before
  });

  test("the dialog carries NO advisory note about the group coming from a saved meal", async ({ page }) => {
    const meal = await seedMeal(client, user, "QA Advisory Origin", [
      { name: "QA Advisory Item", caloriesPerUnit: 100, proteinGPerUnit: 5 },
    ]);
    await seedEntries(client, user, [
      { name: "QA Advisory Item", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: pastInstant(15), loggedFromMealId: meal.id },
    ]);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA Advisory Item");
    const dialogText = (await group.locator("form").innerText()).toLowerCase();
    expect(dialogText).not.toContain("separate copy");
    expect(dialogText).not.toContain("came from");
    expect(dialogText).not.toContain("already");
  });

  test("independence: deleting the new meal leaves the source entries untouched", async ({ page }) => {
    const at = pastInstant(50);
    await seedEntries(client, user, [
      { name: "QA Indep A", caloriesPerUnit: 150, proteinGPerUnit: 8, consumedAt: at },
      { name: "QA Indep B", caloriesPerUnit: 90, proteinGPerUnit: 1, consumedAt: at },
    ]);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA Indep A");
    await group.getByLabel("Meal name").fill("QA Deletable");
    await group.getByRole("button", { name: "Save meal" }).click();
    await expect(page.getByText('Saved as "QA Deletable".')).toBeVisible();

    const before = await entriesForUser(user.id);
    const meals = await mealsForUser(user.id);
    const { error } = await client.from("meals").delete().eq("id", meals[0].id);
    expect(error).toBeNull();

    expect(await itemsOfMeal(meals[0].id)).toHaveLength(0); // cascaded
    expect(await entriesForUser(user.id)).toEqual(before); // sources untouched
  });

  test("independence: editing/deleting a source entry afterwards leaves the meal's items untouched", async ({ page }) => {
    const at = pastInstant(55);
    const sources = await seedEntries(client, user, [
      { name: "QA Mut A", quantity: 1, caloriesPerUnit: 200, proteinGPerUnit: 10, consumedAt: at },
      { name: "QA Mut B", quantity: 1, caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: at },
    ]);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA Mut A");
    await group.getByLabel("Meal name").fill("QA Frozen");
    await group.getByRole("button", { name: "Save meal" }).click();
    await expect(page.getByText('Saved as "QA Frozen".')).toBeVisible();

    const meals = await mealsForUser(user.id);
    const itemsBefore = await itemsOfMeal(meals[0].id);

    await client.from("food_entries").update({ name: "QA Mut A RENAMED", calories_per_unit: 999 }).eq("id", sources[0].id);
    await client.from("food_entries").delete().eq("id", sources[1].id);

    expect(await itemsOfMeal(meals[0].id)).toEqual(itemsBefore);
  });
});

// =============================================================================================
// 3. Ownership / rejection paths -- zero rows written anywhere
// =============================================================================================

test.describe("Phase7b QA: ownership + rejections write nothing", () => {
  let attacker: TestUser;
  let victim: TestUser;
  let attackerClient: SupabaseClient;
  let victimClient: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    attacker = await createConfirmedTestUser();
    victim = await createConfirmedTestUser();
    attackerClient = await createUserClient(attacker);
    victimClient = await createUserClient(victim);
    await logIn(page, attacker);
  });
  test.afterEach(async () => {
    await deleteTestUser(attacker.id);
    await deleteTestUser(victim.id);
  });

  async function assertNothingWritten() {
    expect(await mealsForUser(attacker.id)).toHaveLength(0);
    expect(await mealsForUser(victim.id)).toHaveLength(0);
    expect(await itemsForUser(attacker.id)).toHaveLength(0);
    expect(await itemsForUser(victim.id)).toHaveLength(0);
  }

  test("ANOTHER user real entry id alone is rejected, zero rows for either user", async ({ page }) => {
    const victimEntries = await seedEntries(victimClient, victim, [
      { name: "QA Victim Steak", caloriesPerUnit: 600, proteinGPerUnit: 50, consumedAt: pastInstant(10) },
    ]);
    await seedEntries(attackerClient, attacker, [
      { name: "QA Attacker Snack", caloriesPerUnit: 100, proteinGPerUnit: 1, consumedAt: pastInstant(12) },
    ]);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA Attacker Snack");
    await forceEntryIds(page, [victimEntries[0].id]);
    await group.getByLabel("Meal name").fill("QA Stolen");
    await group.getByRole("button", { name: "Save meal" }).click();

    await expect(page.getByText(/find those entries/i)).toBeVisible();
    await assertNothingWritten();
  });

  test("a MIXED set (own id + another user id) is rejected wholesale, not partially saved", async ({ page }) => {
    const victimEntries = await seedEntries(victimClient, victim, [
      { name: "QA Victim Rice", caloriesPerUnit: 200, proteinGPerUnit: 4, consumedAt: pastInstant(10) },
    ]);
    const ownEntries = await seedEntries(attackerClient, attacker, [
      { name: "QA Own Salad", caloriesPerUnit: 80, proteinGPerUnit: 3, consumedAt: pastInstant(12) },
    ]);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA Own Salad");
    await forceEntryIds(page, [ownEntries[0].id, victimEntries[0].id]);
    await group.getByLabel("Meal name").fill("QA Mixed");
    await group.getByRole("button", { name: "Save meal" }).click();

    await expect(page.getByText(/find those entries/i)).toBeVisible();
    // The critical part: NOT a partial meal containing only the attacker own entry.
    await assertNothingWritten();
  });

  test("a nonexistent entry id is rejected with zero rows", async ({ page }) => {
    const ownEntries = await seedEntries(attackerClient, attacker, [
      { name: "QA Own Wrap", caloriesPerUnit: 400, proteinGPerUnit: 20, consumedAt: pastInstant(12) },
    ]);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA Own Wrap");
    await forceEntryIds(page, [ownEntries[0].id, "00000000-0000-4000-8000-000000000000"]);
    await group.getByLabel("Meal name").fill("QA Ghost");
    await group.getByRole("button", { name: "Save meal" }).click();

    await expect(page.getByText(/find those entries/i)).toBeVisible();
    await assertNothingWritten();
  });

  test("empty entryIds is rejected (no_entries) with zero rows", async ({ page }) => {
    await seedEntries(attackerClient, attacker, [
      { name: "QA Empty Src", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: pastInstant(12) },
    ]);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA Empty Src");
    await forceEntryIds(page, []);
    await group.getByLabel("Meal name").fill("QA Nothing");
    await group.getByRole("button", { name: "Save meal" }).click();

    await expect(page.getByText(/Nothing to save/i)).toBeVisible();
    await assertNothingWritten();
  });

  test("a blank name is rejected as a field error with zero rows", async ({ page }) => {
    await seedEntries(attackerClient, attacker, [
      { name: "QA Blank Src", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: pastInstant(12) },
    ]);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA Blank Src");
    await group.getByRole("button", { name: "Save meal" }).click();

    await expect(group.getByLabel("Meal name")).toBeVisible();
    await assertNothingWritten();
  });

  test("a whitespace-only name is rejected with zero rows", async ({ page }) => {
    await seedEntries(attackerClient, attacker, [
      { name: "QA WS Src", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: pastInstant(12) },
    ]);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA WS Src");
    await group.getByLabel("Meal name").fill("     ");
    await group.getByRole("button", { name: "Save meal" }).click();

    await expect(group.getByLabel("Meal name")).toBeVisible();
    await assertNothingWritten();
  });

  test("a duplicated entry id does not create a duplicate item (dedupe, not a count-check bypass)", async ({ page }) => {
    const own = await seedEntries(attackerClient, attacker, [
      { name: "QA Dupe Src", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: pastInstant(12) },
    ]);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA Dupe Src");
    await forceEntryIds(page, [own[0].id, own[0].id, own[0].id]);
    await group.getByLabel("Meal name").fill("QA Dedupe");
    await group.getByRole("button", { name: "Save meal" }).click();
    await expect(page.getByText('Saved as "QA Dedupe".')).toBeVisible();

    const meals = await mealsForUser(attacker.id);
    expect(meals).toHaveLength(1);
    expect(await itemsOfMeal(meals[0].id)).toHaveLength(1);
  });
});

// =============================================================================================
// 4. The blank-name-field decision (an explicit override of the architect recommendation)
// =============================================================================================

test.describe("Phase7b QA: the name field opens blank", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
  });
  test.afterEach(async () => { await deleteTestUser(user.id); });

  test("the input VALUE is empty on open (a placeholder is not a value) and it is autofocused", async ({ page }) => {
    const at = pastInstant(18);
    await seedEntries(client, user, [
      { name: "QA Prefill Trap", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: at },
      { name: "QA Second Item", caloriesPerUnit: 50, proteinGPerUnit: 1, consumedAt: at },
    ]);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA Prefill Trap");
    const nameInput = group.getByLabel("Meal name");

    await expect(nameInput).toHaveValue("");
    await expect(nameInput).toHaveAttribute("placeholder", /.+/);
    expect(await nameInput.inputValue()).not.toContain("QA Prefill Trap");
    await expect(nameInput).toBeFocused();
  });

  test("reopening the expander after a cancel still opens blank", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA Reopen", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: pastInstant(18) },
    ]);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA Reopen");
    await group.getByLabel("Meal name").fill("typed but abandoned");
    // NB: two buttons read "Cancel" while the expander is open -- the group-header toggle
    // and the dialog own Cancel. Scope to the dialog form.
    await group.locator("form").getByRole("button", { name: "Cancel" }).click();
    await expect(group.getByLabel("Meal name")).toHaveCount(0);

    await group.getByRole("button", { name: "Save as meal" }).click();
    await expect(group.getByLabel("Meal name")).toHaveValue("");
    expect(await mealsForUser(user.id)).toHaveLength(0);
  });
});

// =============================================================================================
// 5. The hasLoadedOnce prerequisite: a background refresh must not eat the open expander
// =============================================================================================

test.describe("Phase7b QA: hasLoadedOnce prerequisite", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
  });
  test.afterEach(async () => { await deleteTestUser(user.id); });

  test("adding an unrelated entry does not collapse an open expander or clear its typed name", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA Keepopen", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: pastInstant(60) },
    ]);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA Keepopen");
    await group.getByLabel("Meal name").fill("half-typed name");

    // Trigger a real background day refresh from elsewhere on the page: add another entry.
    const addForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Add entry" }) });
    await addForm.getByLabel("Name", { exact: true }).fill("QA Interrupter");
    await addForm.getByLabel(/calories/i).fill("42");
    await addForm.getByLabel(/protein/i).fill("1");
    await addForm.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("QA Interrupter")).toBeVisible();

    // The expander and its in-flight name must both survive the refresh.
    await expect(group.getByLabel("Meal name")).toBeVisible();
    await expect(group.getByLabel("Meal name")).toHaveValue("half-typed name");
  });

  test("deleting an unrelated entry does not collapse an open expander", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA Stay", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: pastInstant(70) },
    ]);
    await seedEntries(client, user, [
      { name: "QA Doomed", caloriesPerUnit: 10, proteinGPerUnit: 1, consumedAt: pastInstant(65) },
    ]);

    await page.goto("/food");
    const group = await openSaveAsMeal(page, "QA Stay");
    await group.getByLabel("Meal name").fill("survives a delete");

    const doomedGroup = page.locator("section", { hasText: "QA Doomed" });
    await doomedGroup.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("QA Doomed")).toHaveCount(0);

    await expect(group.getByLabel("Meal name")).toHaveValue("survives a delete");
  });
});

// =============================================================================================
// 6. Duplicates by design + fault injection for the compensating delete
// =============================================================================================

test.describe("Phase7b QA: duplicates + atomicity", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
  });
  test.afterEach(async () => { await deleteTestUser(user.id); });

  test("saving the same group twice produces two independent meals (no uniqueness constraint)", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA Twice", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: pastInstant(22) },
    ]);

    await page.goto("/food");
    for (const label of ["QA Copy One", "QA Copy Two"]) {
      const group = await openSaveAsMeal(page, "QA Twice");
      await group.getByLabel("Meal name").fill(label);
      await group.getByRole("button", { name: "Save meal" }).click();
      await expect(page.getByText("Saved as " + JSON.stringify(label) + ".")).toBeVisible();
    }

    const meals = await mealsForUser(user.id);
    expect(meals).toHaveLength(2);
    expect(meals.map((m) => m.name).sort()).toEqual(["QA Copy One", "QA Copy Two"]);
    expect(meals[0].id).not.toBe(meals[1].id);
    for (const meal of meals) expect(await itemsOfMeal(meal.id)).toHaveLength(1);
  });

  test("FAULT INJECTION: a failed meal_items insert leaves no orphan meal (compensating delete)", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA Compensate", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: pastInstant(28) },
    ]);

    // Force the SECOND statement (meal_items insert) to fail while the first (meals insert)
    // succeeds -- the exact residual-state window the atomicity decision is about.
    psql(BLOCK_TRIGGER_SQL);

    try {
      await page.goto("/food");
      const group = await openSaveAsMeal(page, "QA Compensate");
      await group.getByLabel("Meal name").fill("QA Orphan Check");
      await group.getByRole("button", { name: "Save meal" }).click();
      // It must fail: the expander stays open and no success message appears.
      await expect(group.getByLabel("Meal name")).toBeVisible();
      await expect(page.getByText("Saved as")).toHaveCount(0);
      await page.waitForTimeout(2000);
    } finally {
      psql(DROP_TRIGGER_SQL);
    }

    // ...and the compensating delete must have removed the half-created meal.
    expect(await mealsForUser(user.id)).toHaveLength(0);
    expect(await itemsForUser(user.id)).toHaveLength(0);
  });
});

// SQL used by the fault-injection test above. Declared at module scope (evaluated before any test
// callback runs) and kept deliberately narrow: one BEFORE INSERT trigger on meal_items only, always
// dropped again in a finally block.
const BLOCK_TRIGGER_SQL =
  "create or replace function public.qa7b_block_items() returns trigger as " +
  "$fn$ begin raise exception 'QA7B forced meal_items failure'; end; $fn$ language plpgsql; " +
  "create trigger qa7b_block_items before insert on public.meal_items " +
  "for each row execute function public.qa7b_block_items();";

const DROP_TRIGGER_SQL =
  "drop trigger if exists qa7b_block_items on public.meal_items; " +
  "drop function if exists public.qa7b_block_items();";

// =============================================================================================
// 7. Negative control for the fault-injection test above
// =============================================================================================

test.describe("Phase7b QA: fault-injection negative control", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async () => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
  });
  test.afterEach(async () => { await deleteTestUser(user.id); });

  test("without a compensating delete the SAME two statements DO leave an orphan meal", async () => {
    // Proves the previous test is meaningful: the blocking trigger does NOT roll back the already
    // committed `meals` insert, so the meal disappearing in that test can only be the action own
    // compensating delete -- not an artefact of the whole thing failing atomically anyway.
    psql(BLOCK_TRIGGER_SQL);
    try {
      const { data: meal, error } = await client
        .from("meals")
        .insert({ user_id: user.id, name: "QA Orphan Control" })
        .select()
        .single();
      expect(error).toBeNull();
      expect(meal).not.toBeNull();

      const { error: itemsError } = await client.from("meal_items").insert({
        meal_id: (meal as Meal).id,
        user_id: user.id,
        name: "QA Orphan Item",
        quantity: 1,
        calories_per_unit: 10,
        protein_g_per_unit: 1,
        sort_order: 0,
      });
      expect(itemsError).not.toBeNull();
    } finally {
      psql(DROP_TRIGGER_SQL);
    }

    // No compensating delete was issued here, so the meal survives -- the exact residual state the
    // action guards against.
    const orphans = await mealsForUser(user.id);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].name).toBe("QA Orphan Control");
    expect(await itemsOfMeal(orphans[0].id)).toHaveLength(0);
  });
});

import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";
import { createAdminClient } from "./helpers/admin-client";
import type { FoodEntry, Meal, MealItem } from "../src/lib/types";

/**
 * QA-REVIEWER independent Phase 8c acceptance suite -- "Log a saved meal from the /meals library".
 *
 * Written from docs/architecture/food-weight-tracker.md 3.4 ("Logging a saved meal straight from
 * the library"), 6's "Logging a saved meal from the /meals library" rows and 8 Phase 8c's In/Out
 * scope -- NOT from the implementation, which was read only afterwards to look for gaps.
 *
 * Every "what was actually written?" assertion goes through the SERVICE-ROLE admin client.
 * The browser is pinned to UTC so "today" is unambiguous.
 */

test.use({ timezoneId: "UTC" });

async function logIn(page: Page, user: TestUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function utcDateOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function expectedDateLabel(iso: string): string {
  const parts = iso.split("-");
  return parts[1] + "/" + parts[2] + "/" + parts[0];
}

type ItemSpec = { name: string; quantity?: number; unit?: string | null; kcal: number; protein: number };

async function seedMeal(
  client: SupabaseClient,
  user: TestUser,
  name: string,
  items: ItemSpec[],
): Promise<Meal> {
  const { data: meal, error } = await client
    .from("meals")
    .insert({ user_id: user.id, name })
    .select()
    .single();
  if (error || !meal) throw new Error("seedMeal failed: " + (error ? error.message : "no data"));
  let sort = 0;
  for (const it of items) {
    const { error: itemError } = await client.from("meal_items").insert({
      user_id: user.id,
      meal_id: (meal as Meal).id,
      name: it.name,
      quantity: it.quantity ?? 1,
      unit: it.unit ?? null,
      calories_per_unit: it.kcal,
      protein_g_per_unit: it.protein,
      sort_order: sort++,
    });
    if (itemError) throw new Error("seedMeal item failed: " + itemError.message);
  }
  return meal as Meal;
}

async function entriesForUser(userId: string): Promise<FoodEntry[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("food_entries")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error("admin food_entries read failed: " + error.message);
  return (data ?? []) as FoodEntry[];
}

async function itemsForMeal(mealId: string): Promise<MealItem[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("meal_items")
    .select("*")
    .eq("meal_id", mealId)
    .order("sort_order", { ascending: true });
  if (error) throw new Error("admin meal_items read failed: " + error.message);
  return (data ?? []) as MealItem[];
}

/** The floor-of-now quarter hour, computed independently of the app. */
function flooredNow(): string {
  const d = new Date();
  const mins = Math.floor(d.getUTCMinutes() / 15) * 15;
  return String(d.getUTCHours()).padStart(2, "0") + ":" + String(mins).padStart(2, "0");
}

async function openLogExpander(page: Page, mealName: string) {
  const cards = page.locator("div").filter({ has: page.getByRole("button", { name: "Log this meal" }) });
  const target = cards.filter({ hasText: mealName }).last();
  await target.getByRole("button", { name: "Log this meal" }).click();
  await expect(page.locator("#log-meal-date")).toBeVisible();
  return target;
}

test.describe("Phase8c QA: logging a saved meal from /meals", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("logs the RIGHT meal when several similar ones exist -- exact items, correct logged_from_meal_id", async ({ page }) => {
    const a = await seedMeal(client, user, "QA8c Breakfast A", [
      { name: "QA8c Eggs A", quantity: 3, unit: "egg", kcal: 78, protein: 6.2 },
    ]);
    const b = await seedMeal(client, user, "QA8c Breakfast B", [
      { name: "QA8c Oats B", quantity: 1.5, unit: "bowl", kcal: 205.33, protein: 7.11 },
      { name: "QA8c Toast B", quantity: 2, unit: "slice", kcal: 91.5, protein: 3.25 },
    ]);
    const c = await seedMeal(client, user, "QA8c Breakfast C", [
      { name: "QA8c Yogurt C", quantity: 1, unit: "cup", kcal: 149, protein: 8.5 },
    ]);

    await page.goto("/meals");
    await expect(page.getByText("QA8c Breakfast B")).toBeVisible();

    // Pick the MIDDLE card deliberately: choosing the wrong one would still write rows, so a
    // "some rows appeared" check would pass -- the item identity is what proves the right card.
    await openLogExpander(page, "QA8c Breakfast B");
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByText(/Logged "QA8c Breakfast B"/)).toBeVisible();

    const written = await entriesForUser(user.id);
    expect(written).toHaveLength(2);
    expect(written.map((e) => e.name).sort()).toEqual(["QA8c Oats B", "QA8c Toast B"]);
    for (const e of written) {
      expect(e.logged_from_meal_id).toBe(b.id);
      expect(e.user_id).toBe(user.id);
    }

    // Values copied faithfully, and the generated columns match the source meal_items exactly.
    const sourceItems = await itemsForMeal(b.id);
    for (const item of sourceItems) {
      const match = written.find((e) => e.name === item.name);
      expect(match).toBeDefined();
      expect(match!.quantity).toBe(item.quantity);
      expect(match!.unit).toBe(item.unit);
      expect(match!.calories_per_unit).toBe(item.calories_per_unit);
      expect(match!.protein_g_per_unit).toBe(item.protein_g_per_unit);
      expect(match!.calories).toBe(item.calories);
      expect(match!.protein_g).toBe(item.protein_g);
    }

    // Neither neighbouring meal was touched or logged.
    expect(written.some((e) => e.logged_from_meal_id === a.id)).toBe(false);
    expect(written.some((e) => e.logged_from_meal_id === c.id)).toBe(false);
  });

  test("batch semantics match the /food path: one shared consumed_at/tz/local_date, exactly one group, and the day totals include it", async ({ page }) => {
    await seedMeal(client, user, "QA8c Batch meal", [
      { name: "QA8c Batch 1", quantity: 1, kcal: 120, protein: 5 },
      { name: "QA8c Batch 2", quantity: 2, kcal: 60, protein: 2 },
      { name: "QA8c Batch 3", quantity: 1, kcal: 200, protein: 11 },
    ]);
    await page.goto("/meals");
    await openLogExpander(page, "QA8c Batch meal");
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByText(/Logged "QA8c Batch meal"/)).toBeVisible();

    const written = await entriesForUser(user.id);
    expect(written).toHaveLength(3);
    expect(new Set(written.map((e) => e.consumed_at)).size).toBe(1);
    expect(new Set(written.map((e) => e.consumed_tz)).size).toBe(1);
    expect(new Set(written.map((e) => e.consumed_local_date))).toEqual(new Set([todayUtc()]));

    const admin = createAdminClient();
    const { data: totals } = await admin
      .from("daily_food_totals")
      .select("*")
      .eq("user_id", user.id)
      .eq("consumed_local_date", todayUtc())
      .maybeSingle();
    expect(totals).not.toBeNull();
    expect((totals as { total_calories: number; entry_count: number }).total_calories).toBe(120 + 120 + 200);
    expect((totals as { entry_count: number }).entry_count).toBe(3);

    // Exactly one exact-timestamp group on /food.
    await page.goto("/food");
    await expect(page.getByText("QA8c Batch 1")).toBeVisible();
    const groups = page.locator("section").filter({ hasText: "QA8c Batch" });
    await expect(groups).toHaveCount(1);
    await expect(page.getByText("From a saved meal")).toHaveCount(3);
  });

  test("defaults: date is today, time is the FLOOR of the current quarter hour, exactly 96 time options and NO keep-original sentinel", async ({ page }) => {
    await seedMeal(client, user, "QA8c Defaults meal", [{ name: "QA8c D1", kcal: 100, protein: 5 }]);
    await page.goto("/meals");
    await openLogExpander(page, "QA8c Defaults meal");

    await expect(page.locator("#log-meal-date")).toHaveValue(todayUtc());
    await expect(page.locator("#log-meal-date")).toHaveAttribute("max", todayUtc());

    const timeSelect = page.locator("#log-meal-time");
    const value = await timeSelect.inputValue();
    // Floor, never round-up: the chosen bucket is at or before now (so it can never be a future
    // instant that the no-future-day cap would then have to reject).
    expect([flooredNow(), value]).toContain(value);
    expect(Number(value.slice(3)) % 15).toBe(0);
    const now = new Date();
    const nowMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    const pickedMinutes = Number(value.slice(0, 2)) * 60 + Number(value.slice(3));
    expect(pickedMinutes).toBeLessThanOrEqual(nowMinutes);
    expect(nowMinutes - pickedMinutes).toBeLessThan(15);

    const options = timeSelect.locator("option");
    await expect(options).toHaveCount(96);
    const values = await options.evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    expect(values[0]).toBe("00:00");
    expect(values[95]).toBe("23:45");
    // The "keep original time" sentinel belongs ONLY to the copy override -- a saved meal has no
    // existing consumed_at to keep, so it must not appear here.
    expect(values).not.toContain("");
    const labels = await options.evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).textContent));
    expect(labels.some((l) => (l ?? "").toLowerCase().includes("keep original"))).toBe(false);
  });

  test("a chosen PAST date and a chosen time are honoured -- the whole point of the feature", async ({ page }) => {
    const past = utcDateOffset(-5);
    await seedMeal(client, user, "QA8c Past meal", [
      { name: "QA8c P1", quantity: 1, kcal: 111, protein: 4 },
      { name: "QA8c P2", quantity: 1, kcal: 222, protein: 8 },
    ]);
    await page.goto("/meals");
    await openLogExpander(page, "QA8c Past meal");
    await page.locator("#log-meal-date").fill(past);
    await page.locator("#log-meal-time").selectOption("06:45");
    await page.getByRole("button", { name: "Log meal" }).click();

    await expect(page.getByText(/Logged "QA8c Past meal"/)).toBeVisible();
    const written = await entriesForUser(user.id);
    expect(written).toHaveLength(2);
    for (const e of written) {
      expect(e.consumed_local_date).toBe(past);
      expect(new Date(e.consumed_at).toISOString()).toBe(new Date(past + "T06:45:00Z").toISOString());
    }

    // The confirmation names the meal, the date (MM/DD/YYYY, never ISO) and the time.
    const status = page.locator('[role="status"]');
    await expect(status).toContainText(expectedDateLabel(past));
    await expect(status).not.toContainText(past);
    await expect(status).toContainText("06:45 AM");
  });

  test("the no-future-day cap holds through this new entry point even with the input max stripped, writing ZERO rows", async ({ page }) => {
    const future = utcDateOffset(3);
    await seedMeal(client, user, "QA8c Cap meal", [{ name: "QA8c C1", kcal: 100, protein: 5 }]);
    await page.goto("/meals");
    await openLogExpander(page, "QA8c Cap meal");
    await page.locator("#log-meal-date").evaluate((el) => el.removeAttribute("max"));
    await page.locator("#log-meal-date").fill(future);
    await page.getByRole("button", { name: "Log meal" }).click();

    await expect(page.getByText(/You can.t log a meal dated later than today/)).toBeVisible();
    expect(await entriesForUser(user.id)).toHaveLength(0);
  });

  test("ownership: submitting ANOTHER user's mealId directly is rejected with zero rows for either user", async ({ page }) => {
    const other = await createConfirmedTestUser();
    try {
      const otherClient = await createUserClient(other);
      const foreignMeal = await seedMeal(otherClient, other, "QA8c Foreign meal", [
        { name: "QA8c Foreign item", kcal: 500, protein: 40 },
      ]);
      await seedMeal(client, user, "QA8c Own meal", [{ name: "QA8c Own item", kcal: 100, protein: 5 }]);

      await page.goto("/meals");
      await openLogExpander(page, "QA8c Own meal");
      // Tamper the hidden mealId exactly as a hostile client would.
      await page.locator('input[name="mealId"]').evaluate((el, id) => {
        (el as HTMLInputElement).value = id;
      }, foreignMeal.id);
      await page.getByRole("button", { name: "Log meal" }).click();

      // Whatever the surfaced message, the invariant is that nothing was written for anyone.
      await page.waitForTimeout(1500);
      expect(await entriesForUser(user.id)).toHaveLength(0);
      expect(await entriesForUser(other.id)).toHaveLength(0);
    } finally {
      await deleteTestUser(other.id);
    }
  });

  test("an EMPTY meal is still rejected from this surface", async ({ page }) => {
    await seedMeal(client, user, "QA8c Empty meal", []);
    await page.goto("/meals");
    await openLogExpander(page, "QA8c Empty meal");
    await page.getByRole("button", { name: "Log meal" }).click();

    await expect(page.getByText(/no items yet/i)).toBeVisible();
    expect(await entriesForUser(user.id)).toHaveLength(0);
  });

  test("SUCCESS DISTURBS NOTHING: the active filter, the count readout, the rendered cards and the expanded card all survive, with NO refetch", async ({ page }) => {
    await seedMeal(client, user, "QA8c Chicken bowl", [{ name: "QA8c CB1", kcal: 400, protein: 35 }]);
    await seedMeal(client, user, "QA8c Chicken salad", [{ name: "QA8c CS1", kcal: 250, protein: 30 }]);
    await seedMeal(client, user, "QA8c Zebra oats", [{ name: "QA8c ZO1", kcal: 300, protein: 9 }]);

    await page.goto("/meals");
    await expect(page.getByText("3 saved meals")).toBeVisible();

    await page.getByLabel("Filter meals").fill("chicken");
    await expect(page.getByText("Showing 2 of 3")).toBeVisible();
    await expect(page.getByText("QA8c Zebra oats")).toHaveCount(0);

    // Collapse ONE card so there is a non-default expansion state to preserve.
    const cards = page.locator("div").filter({ has: page.getByRole("button", { name: "Log this meal" }) });
    const salad = cards.filter({ hasText: "QA8c Chicken salad" }).last();
    await salad.getByRole("button", { name: "Hide items" }).click();
    await expect(salad.getByRole("button", { name: "Manage items" })).toBeVisible();
    await expect(page.getByText("QA8c CS1")).toHaveCount(0);

    // Count Supabase reads from here on -- a refetch would show up as new /rest/v1 requests.
    const reads: string[] = [];
    page.on("request", (r) => {
      const u = r.url();
      if (u.includes("/rest/v1/meals") || u.includes("/rest/v1/meal_items")) reads.push(u);
    });

    await openLogExpander(page, "QA8c Chicken bowl");
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByText(/Logged "QA8c Chicken bowl"/)).toBeVisible();

    // The write really happened...
    expect(await entriesForUser(user.id)).toHaveLength(1);
    // ...and NOTHING on this screen moved.
    await expect(page.getByLabel("Filter meals")).toHaveValue("chicken");
    await expect(page.getByText("Showing 2 of 3")).toBeVisible();
    await expect(page.getByText("QA8c Zebra oats")).toHaveCount(0);
    await expect(salad.getByRole("button", { name: "Manage items" })).toBeVisible();
    await expect(page.getByText("QA8c CS1")).toHaveCount(0);
    // The other card is still expanded.
    await expect(page.getByText("QA8c CB1")).toBeVisible();
    expect(reads, "a refetch of meals/meal_items happened: " + JSON.stringify(reads)).toEqual([]);
  });

  test("only ONE log expander is open at a time across the list", async ({ page }) => {
    await seedMeal(client, user, "QA8c Mutex one", [{ name: "QA8c M1", kcal: 100, protein: 5 }]);
    await seedMeal(client, user, "QA8c Mutex two", [{ name: "QA8c M2", kcal: 100, protein: 5 }]);
    await page.goto("/meals");

    await openLogExpander(page, "QA8c Mutex one");
    await expect(page.locator("#log-meal-date")).toHaveCount(1);
    await openLogExpander(page, "QA8c Mutex two");
    await expect(page.locator("#log-meal-date")).toHaveCount(1);
    // Exactly one meal is in the "open" state, i.e. exactly one card toggle reads "Cancel".
    await expect(page.getByRole("button", { name: "Log this meal" })).toHaveCount(1);
  });

  test("'Log this meal' is the FIRST action in each card's action row", async ({ page }) => {
    await seedMeal(client, user, "QA8c Order meal", [{ name: "QA8c O1", kcal: 100, protein: 5 }]);
    await page.goto("/meals");
    await expect(page.getByRole("button", { name: "Log this meal" })).toBeVisible();

    const labels = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => (b.textContent ?? "").trim() === "Log this meal",
      );
      const rowEl = btn ? (btn.parentElement as HTMLElement) : null;
      return rowEl
        ? Array.from(rowEl.querySelectorAll("button")).map((b) => (b.textContent ?? "").trim())
        : [];
    });
    expect(labels[0]).toBe("Log this meal");
    expect(labels).toContain("Hide items");
    expect(labels).toContain("Rename");
    expect(labels).toContain("Delete");
  });

  test("/food's own LogMealDialog picker path is unregressed by the new fixed-meal mode", async ({ page }) => {
    await seedMeal(client, user, "QA8c Picker meal", [
      { name: "QA8c PK1", quantity: 2, unit: "slice", kcal: 91.5, protein: 3.25 },
    ]);
    await page.goto("/food");
    await page.getByRole("button", { name: "Log a saved meal" }).click();

    // Still a real picker with the placeholder option, not a fixed meal.
    const picker = page.getByLabel("Meal");
    await expect(picker).toBeVisible();
    await expect(picker.locator("option")).toHaveCount(2);
    await picker.selectOption({ index: 1 });
    await expect(page.locator("#log-meal-date")).toHaveValue(todayUtc());
    await page.getByRole("button", { name: "Log meal" }).click();

    await expect(page.getByText("Meal logged.")).toBeVisible();
    const written = await entriesForUser(user.id);
    expect(written).toHaveLength(1);
    expect(written[0].name).toBe("QA8c PK1");
    expect(written[0].logged_from_meal_id).not.toBeNull();
    await expect(page.getByText("From a saved meal")).toHaveCount(1);
  });

  test("explicit non-goals are NOT built: no servings multiplier, no selection UI on /meals, and no navigation away after logging", async ({ page }) => {
    await seedMeal(client, user, "QA8c Scope meal", [{ name: "QA8c S1", kcal: 100, protein: 5 }]);
    await page.goto("/meals");
    await openLogExpander(page, "QA8c Scope meal");

    // No quantity/servings/multiplier control anywhere in the expander.
    const controls = await page.evaluate(() =>
      Array.from(document.querySelectorAll("label")).map((l) => (l.textContent ?? "").trim()),
    );
    expect(controls.some((l) => /serving|multiplier|quantity|how many/i.test(l))).toBe(false);
    // No multi-select on /meals.
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Select (entries|meals)/ })).toHaveCount(0);

    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByText(/Logged "QA8c Scope meal"/)).toBeVisible();
    // Still on /meals -- the user is deliberately working in the library.
    await expect(page).toHaveURL(/\/meals$/);
  });

  test("/meals renders with no hydration-mismatch console errors despite its new browser-timezone dependency", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error" || msg.type() === "warning") {
        const t = msg.text();
        if (/hydrat|did not match|server rendered|mismatch/i.test(t)) problems.push(t);
      }
    });
    page.on("pageerror", (e) => problems.push("pageerror: " + e.message));

    await seedMeal(client, user, "QA8c Hydration meal", [{ name: "QA8c H1", kcal: 100, protein: 5 }]);
    await page.goto("/meals");
    await expect(page.getByRole("button", { name: "Log this meal" })).toBeVisible();
    await page.waitForTimeout(1000);
    expect(problems, problems.join(" | ")).toEqual([]);
  });

  test("the tz gate is scoped to the log control only -- the list, filter and counts render regardless", async ({ page }) => {
    await seedMeal(client, user, "QA8c Gate meal", [{ name: "QA8c G1", kcal: 100, protein: 5 }]);
    await page.goto("/meals");
    // These must not be blocked behind the tz resolution (the design doc scopes the gate narrowly).
    await expect(page.getByText("QA8c Gate meal")).toBeVisible();
    await expect(page.getByLabel("Filter meals")).toBeVisible();
    await expect(page.getByText("1 saved meal")).toBeVisible();
    await expect(page.getByRole("button", { name: "Log this meal" })).toBeVisible();
  });

  test("the log expander renders no nested <form> (the Phase 6 bug class) -- Save really submits", async ({ page }) => {
    await seedMeal(client, user, "QA8c Nested meal", [{ name: "QA8c N1", kcal: 100, protein: 5 }]);
    await page.goto("/meals");
    await openLogExpander(page, "QA8c Nested meal");

    const nested = await page.evaluate(() =>
      Array.from(document.querySelectorAll("form")).filter((f) => f.closest("form") !== f).length,
    );
    expect(nested).toBe(0);
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByText(/Logged "QA8c Nested meal"/)).toBeVisible();
    expect(await entriesForUser(user.id)).toHaveLength(1);
  });

  test("Cancel closes the expander without writing anything", async ({ page }) => {
    await seedMeal(client, user, "QA8c Cancel meal", [{ name: "QA8c X1", kcal: 100, protein: 5 }]);
    await page.goto("/meals");
    await openLogExpander(page, "QA8c Cancel meal");
    // NOTE: two buttons read "Cancel" here (the card toggle and the dialog) -- reported as a
    // finding; .last() targets the dialog one.
    await page.getByRole("button", { name: "Cancel" }).last().click();
    await expect(page.locator("#log-meal-date")).toHaveCount(0);
    expect(await entriesForUser(user.id)).toHaveLength(0);
  });
});

import { test, expect, type Locator, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";
import { createAdminClient } from "./helpers/admin-client";
import type { FoodEntry, Meal, MealItem } from "../src/lib/types";

/**
 * QA-REVIEWER independent Phase 8b acceptance suite -- "Multi-select bulk actions on the day's
 * log", plus the findings folded into the same checkpoint (N-3 stale-error-on-reopen, N-4 "Log
 * again" destination toast, the editing-row highlight, the optional "Copy to time" override, the
 * StatusMessage restyle and the MM/DD/YYYY date format).
 *
 * Written from docs/architecture/food-weight-tracker.md 3.4 (all six Phase 8b blocks), 6's
 * "Multi-select bulk actions" rows and 8 Phase 8b's own In/Out scope -- NOT from the developer's
 * implementation or their own component tests, which were read only afterwards to look for gaps.
 *
 * Every "what was actually written?" assertion goes through the SERVICE-ROLE admin client, so it
 * reflects the database rather than what the page happens to render.
 *
 * The browser is pinned to UTC and fixtures are seeded on TODAY at fixed quarter-hour times --
 * deliberately sidestepping both documented pre-existing flakes (the FoodDayView Day-input
 * navigation race, and the phase7b pastInstant UTC-midnight fixture collision). Where a PAST day
 * genuinely must be viewed (the N-4 row), gotoDay retries the Day input until it actually holds
 * the requested value, converting that known race into a deterministic wait.
 */

test.use({ timezoneId: "UTC" });

async function logIn(page: Page, user: TestUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/food");
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function utcDateOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A fixed wall-clock instant on a given UTC date -- never derived from the current time-of-day. */
function dayAt(date: string, time: string): string {
  return date + "T" + time + ":00.000Z";
}

function todayAt(time: string): string {
  return dayAt(todayUtc(), time);
}

/** MM/DD/YYYY -- computed here independently of the app's own formatDateLabel, on purpose. */
function expectedDateLabel(iso: string): string {
  const parts = iso.split("-");
  return parts[1] + "/" + parts[2] + "/" + parts[0];
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

/** One INSERT per row (never a multi-row insert): Postgres' now() is stable for a whole
 * statement, so a batched seed would give every row an identical created_at and silently defeat
 * the created_at-then-id ordering assertions. */
async function seedEntries(
  client: SupabaseClient,
  user: TestUser,
  rows: SeedEntry[],
): Promise<FoodEntry[]> {
  const out: FoodEntry[] = [];
  for (const r of rows) {
    const { data, error } = await client
      .from("food_entries")
      .insert({
        user_id: user.id,
        name: r.name,
        quantity: r.quantity ?? 1,
        unit: r.unit ?? null,
        calories_per_unit: r.caloriesPerUnit,
        protein_g_per_unit: r.proteinGPerUnit,
        consumed_at: r.consumedAt,
        consumed_tz: "UTC",
        logged_from_meal_id: r.loggedFromMealId ?? null,
      })
      .select()
      .single();
    if (error || !data) throw new Error("seedEntries failed: " + (error ? error.message : "no data"));
    out.push(data as FoodEntry);
  }
  return out;
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

async function mealsForUser(userId: string): Promise<Meal[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("meals").select("*").eq("user_id", userId);
  if (error) throw new Error("admin meals read failed: " + error.message);
  return (data ?? []) as Meal[];
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

/** The entry row for a given entry name. */
function row(page: Page, name: string): Locator {
  return page.locator("li").filter({ hasText: name });
}

function checkboxFor(page: Page, name: string): Locator {
  return page.getByRole("checkbox", { name: new RegExp(name) });
}

/**
 * Navigates the /food Day picker to `date`, retrying until the control actually holds the value.
 * The documented pre-existing race (PROGRESS "Notes") is that a fill() landing before the client
 * component has hydrated is silently dropped; retrying makes that waited-on instead of flaky.
 */
async function gotoDay(page: Page, date: string, expectText?: string) {
  const day = page.locator("#food-day");
  await expect(day).toBeVisible();
  // Hydration gate. The documented pre-existing race (PROGRESS "Notes") is that a fill() landing
  // before FoodDayView has hydrated sets the DOM value but never fires React's onChange, so the
  // day silently does not change -- and a value assertion alone cannot detect that, because the
  // DOM value DID change. Waiting for the initial client-side load to have settled (the
  // "Loading..." placeholder gone) proves hydration happened, and re-filling until the expected
  // content appears converts the remaining race into a deterministic wait.
  await expect(page.getByText("Loading", { exact: false }).first()).toHaveCount(0, { timeout: 15000 });
  for (let attempt = 0; attempt < 15; attempt++) {
    await day.fill(date);
    try {
      await expect(day).toHaveValue(date, { timeout: 1000 });
      if (expectText) {
        await expect(page.getByText(expectText).first()).toBeVisible({ timeout: 2000 });
      }
      return;
    } catch {
      await page.waitForTimeout(300);
    }
  }
  throw new Error("Day input never settled on " + date + " (pre-existing Day-input race)");
}

/** Removes `max` from a date input so a future date can actually be submitted -- proving the cap
 * is enforced server-side, not merely by the widget. */
async function stripMax(page: Page, selector: string) {
  await page.locator(selector).evaluate((el) => el.removeAttribute("max"));
}

function selectionBar(page: Page): Locator {
  // NOTE: scoping is REQUIRED here -- FoodEntryForm also renders a button labelled "Clear", so an
  // unscoped getByRole("button", { name: "Clear" }) is a strict-mode violation whenever select
  // mode is on. Reported as a finding; scoped here so the test measures the bar, not the ambiguity.
  return page.locator("div").filter({ has: page.getByRole("button", { name: "Done" }) }).last();
}

/** PostgREST returns timestamptz as "+00:00"; the fixtures build ".000Z". */
function normalizeInstant(v: string): string {
  return new Date(v).toISOString();
}

/** Tailwind v4 emits rounded-full as calc(infinity * 1px), so the computed value is a huge px. */
function isPillRadius(radius: string): boolean {
  return Number.parseFloat(radius) > 1000;
}

/** Lets CSS transitions finish and moves the pointer off any hover target before measuring
 * computed styles -- entry rows carry both `transition-colors` and `hover:bg-stone-50/70`. */
async function settle(page: Page) {
  await page.mouse.move(0, 0);
  await page.waitForTimeout(500);
}

/** React injects hidden `$ACTION*` inputs into every Server-Action form; those are framework
 * markup, outside the scope of the app-level autoComplete convention. */
function appControls<T extends { name: string }>(controls: T[]): T[] {
  return controls.filter((c) => !c.name.startsWith("$ACTION"));
}

async function enterSelectMode(page: Page) {
  await page.getByRole("button", { name: "Select entries" }).click();
  await expect(page.getByText(/^\d+ selected$/)).toBeVisible();
}

// =============================================================================================
// 1. Entering and leaving select mode
// =============================================================================================

test.describe("Phase8b QA: select mode", () => {
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

  test("'Select entries' is absent on an empty day and present once the day has entries", async ({ page }) => {
    await page.goto("/food");
    await expect(page.getByText("No entries logged for this day yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Select entries" })).toHaveCount(0);

    await seedEntries(client, user, [
      { name: "QA8b Toast", caloriesPerUnit: 120, proteinGPerUnit: 4, consumedAt: todayAt("08:00") },
    ]);
    await page.reload();
    await expect(page.getByRole("button", { name: "Select entries" })).toBeVisible();
  });

  test("entering select mode reveals a checkbox per row and HIDES every per-row and per-group action; Done restores them", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8b Eggs", caloriesPerUnit: 78, proteinGPerUnit: 6, consumedAt: todayAt("08:00") },
      { name: "QA8b Coffee", caloriesPerUnit: 5, proteinGPerUnit: 0, consumedAt: todayAt("08:00") },
      { name: "QA8b Apple", caloriesPerUnit: 95, proteinGPerUnit: 0.5, consumedAt: todayAt("15:00") },
    ]);
    await page.goto("/food");
    await expect(row(page, "QA8b Eggs")).toBeVisible();

    // 2026-08-07 (Phase 8d/8g note): "Delete" is back on the row (Phase 8g reversed Phase 8d's
    // edit-form placement) as a third icon-only action alongside Log again/Edit -- present outside
    // select mode, hidden inside it, exactly like the other two.
    await expect(page.getByRole("button", { name: /Log again/ })).toHaveCount(3);
    await expect(page.getByRole("button", { name: /Edit/ })).toHaveCount(3);
    await expect(page.getByRole("button", { name: /Delete/ })).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Save as meal" })).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Copy this group" })).toHaveCount(2);
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);

    await enterSelectMode(page);

    // Asserting the HIDING explicitly is the point -- two live copy affordances at once is the
    // exact ambiguity the mode exists to prevent (3.4/6).
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Log again" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save as meal" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy this group" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Select entries" })).toHaveCount(0);

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Log again/ })).toHaveCount(3);
    await expect(page.getByRole("button", { name: /Delete/ })).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Copy this group" })).toHaveCount(2);
    await expect(page.getByRole("button", { name: "Select entries" })).toBeVisible();
  });

  test("each checkbox carries an accessible name identifying its own entry", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8b Rice", quantity: 2, unit: "cup", caloriesPerUnit: 200, proteinGPerUnit: 4, consumedAt: todayAt("12:00") },
      { name: "QA8b Beans", caloriesPerUnit: 130, proteinGPerUnit: 8, consumedAt: todayAt("12:00") },
    ]);
    await page.goto("/food");
    await enterSelectMode(page);

    await expect(checkboxFor(page, "QA8b Rice")).toHaveCount(1);
    await expect(checkboxFor(page, "QA8b Beans")).toHaveCount(1);
    await expect(page.getByRole("checkbox", { name: /Select 2 cup .* QA8b Rice/ })).toHaveCount(1);
  });

  test("entering select mode closes an already-open group expander", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8b GrpA", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("09:00") },
    ]);
    await page.goto("/food");
    await page.getByRole("button", { name: "Copy this group" }).click();
    await expect(page.getByLabel("Copy to date")).toBeVisible();

    await enterSelectMode(page);
    await expect(page.getByLabel("Copy to date")).toHaveCount(0);
  });

  test("row-clicking does NOT toggle selection -- only the checkbox does", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8b ClickMe", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("10:00") },
    ]);
    await page.goto("/food");
    await enterSelectMode(page);

    await row(page, "QA8b ClickMe").click({ position: { x: 200, y: 10 } });
    await expect(page.getByText("0 selected")).toBeVisible();

    await checkboxFor(page, "QA8b ClickMe").check();
    await expect(page.getByText("1 selected")).toBeVisible();
  });

  test("bulk actions are disabled at zero selected, enabled once ticked, and 'Clear' re-disables them without leaving the mode", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8b Z1", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("11:00") },
      { name: "QA8b Z2", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("19:00") },
    ]);
    await page.goto("/food");
    await enterSelectMode(page);

    const copyBtn = page.getByRole("button", { name: "Copy selected" });
    const saveBtn = page.getByRole("button", { name: "Save selected as a meal" });
    await expect(copyBtn).toBeDisabled();
    await expect(saveBtn).toBeDisabled();

    await checkboxFor(page, "QA8b Z1").check();
    await checkboxFor(page, "QA8b Z2").check();
    await expect(page.getByText("2 selected")).toBeVisible();
    await expect(copyBtn).toBeEnabled();
    await expect(saveBtn).toBeEnabled();

    await selectionBar(page).getByRole("button", { name: "Clear" }).click();
    await expect(page.getByText("0 selected")).toBeVisible();
    await expect(copyBtn).toBeDisabled();
    await expect(saveBtn).toBeDisabled();
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(2);
  });

  test("changing the day clears the selection and exits select mode, with no resurrection on returning", async ({ page }) => {
    const past = utcDateOffset(-3);
    await seedEntries(client, user, [
      { name: "QA8b DayToday", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("13:00") },
      { name: "QA8b DayPast", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: dayAt(past, "13:00") },
    ]);
    await page.goto("/food");
    await enterSelectMode(page);
    await checkboxFor(page, "QA8b DayToday").check();
    await expect(page.getByText("1 selected")).toBeVisible();

    await gotoDay(page, past, "QA8b DayPast");
    await expect(page.getByText(/^\d+ selected$/)).toHaveCount(0);
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Select entries" })).toBeVisible();

    await gotoDay(page, todayUtc());
    await expect(page.getByText(/^\d+ selected$/)).toHaveCount(0);
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
  });
});

// =============================================================================================
// 2. Copy selected -- exactly the ticked set, across group boundaries (row to hammer #2)
// =============================================================================================

test.describe("Phase8b QA: Copy selected", () => {
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

  test("copies EXACTLY the ticked entries from two different groups -- not their group-mates -- landing as TWO groups each keeping its own time of day", async ({ page }) => {
    const target = utcDateOffset(-4);
    await seedEntries(client, user, [
      { name: "QA8b Pick A", caloriesPerUnit: 210, proteinGPerUnit: 9, consumedAt: todayAt("07:30") },
      { name: "QA8b Mate A", caloriesPerUnit: 111, proteinGPerUnit: 1, consumedAt: todayAt("07:30") },
      { name: "QA8b Pick B", caloriesPerUnit: 320, proteinGPerUnit: 22, consumedAt: todayAt("18:45") },
      { name: "QA8b Mate B", caloriesPerUnit: 222, proteinGPerUnit: 2, consumedAt: todayAt("18:45") },
      { name: "QA8b Untouched", caloriesPerUnit: 50, proteinGPerUnit: 0, consumedAt: todayAt("21:00") },
    ]);
    await page.goto("/food");
    await enterSelectMode(page);
    await checkboxFor(page, "QA8b Pick A").check();
    await checkboxFor(page, "QA8b Pick B").check();
    await expect(page.getByText("2 selected")).toBeVisible();

    await page.getByRole("button", { name: "Copy selected" }).click();
    await page.getByLabel("Copy to date").fill(target);
    await page.getByRole("button", { name: "Copy selected", exact: true }).last().click();
    await expect(page.getByText("Copied 2 entries to " + expectedDateLabel(target))).toBeVisible();

    const copies = (await entriesForUser(user.id)).filter((r) => r.consumed_local_date === target);
    // EXACTLY two rows, and exactly the ticked ones -- a naive "some rows appeared" check would
    // pass even if whole groups had been copied.
    expect(copies).toHaveLength(2);
    expect(copies.map((c) => c.name).sort()).toEqual(["QA8b Pick A", "QA8b Pick B"]);

    // Two distinct instants on the target day == two groups (each preserved its own source
    // time-of-day, per 3.3), not one collapsed mega-group.
    const instants = new Set(copies.map((c) => c.consumed_at));
    expect(instants.size).toBe(2);
    const times = copies.map((c) => c.consumed_at.slice(11, 16)).sort();
    expect(times).toEqual(["07:30", "18:45"]);
    for (const c of copies) {
      expect(c.consumed_local_date).toBe(target);
      expect(c.logged_from_meal_id).toBeNull();
    }
  });

  test("a successful bulk copy clears the selection and exits select mode, so no second copy can be fired by a stray click", async ({ page }) => {
    const target = utcDateOffset(-5);
    await seedEntries(client, user, [
      { name: "QA8b Spent1", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("09:15") },
      { name: "QA8b Spent2", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("14:15") },
    ]);
    await page.goto("/food");
    await enterSelectMode(page);
    await checkboxFor(page, "QA8b Spent1").check();
    await checkboxFor(page, "QA8b Spent2").check();
    await page.getByRole("button", { name: "Copy selected" }).click();
    await page.getByLabel("Copy to date").fill(target);
    await page.getByRole("button", { name: "Copy selected", exact: true }).last().click();

    await expect(page.getByText("Copied 2 entries to " + expectedDateLabel(target))).toBeVisible();
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(page.getByText(/^\d+ selected$/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Select entries" })).toBeVisible();
    await expect(page.getByLabel("Copy to date")).toHaveCount(0);

    expect((await entriesForUser(user.id)).filter((r) => r.consumed_local_date === target)).toHaveLength(2);
  });

  test("the no-future-day cap holds through this new caller even with the input's max stripped, writing ZERO rows", async ({ page }) => {
    const future = utcDateOffset(3);
    await seedEntries(client, user, [
      { name: "QA8b CapMe", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("10:30") },
    ]);
    await page.goto("/food");
    const before = await entriesForUser(user.id);

    await enterSelectMode(page);
    await checkboxFor(page, "QA8b CapMe").check();
    await page.getByRole("button", { name: "Copy selected" }).click();
    await stripMax(page, "#copy-group-target-date");
    await page.getByLabel("Copy to date").fill(future);
    await page.getByRole("button", { name: "Copy selected", exact: true }).last().click();

    await expect(page.getByText(/You can.t copy to a date later than today/)).toBeVisible();
    const after = await entriesForUser(user.id);
    expect(after).toHaveLength(before.length);
    expect(after.some((r) => r.consumed_local_date === future)).toBe(false);
    // Rejection must NOT spend the selection.
    await expect(page.getByText("1 selected")).toBeVisible();
  });

  test("a selected id that vanished out-of-band drops out instead of failing the whole request", async ({ page }) => {
    const target = utcDateOffset(-6);
    const seeded = await seedEntries(client, user, [
      { name: "QA8b Stale Keep", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("11:45") },
      { name: "QA8b Stale Gone", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("16:45") },
    ]);
    await page.goto("/food");
    await enterSelectMode(page);
    await checkboxFor(page, "QA8b Stale Keep").check();
    await checkboxFor(page, "QA8b Stale Gone").check();
    await expect(page.getByText("2 selected")).toBeVisible();

    // Delete one of the SELECTED rows out-of-band (a second client), then force a refresh of the
    // day by adding an unrelated entry through the normal form.
    const admin = createAdminClient();
    const gone = seeded.find((e) => e.name === "QA8b Stale Gone");
    await admin.from("food_entries").delete().eq("id", gone!.id);

    await page.getByLabel("Name", { exact: true }).fill("QA8b Stale Trigger");
    await page.getByLabel("Total calories").fill("10");
    await page.getByLabel("Total protein (g)").fill("1");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Entry added.")).toBeVisible();
    await expect(row(page, "QA8b Stale Gone")).toHaveCount(0);

    // The count drops rather than the bulk action failing wholesale.
    await expect(page.getByText("1 selected")).toBeVisible();
    await page.getByRole("button", { name: "Copy selected" }).click();
    await page.getByLabel("Copy to date").fill(target);
    await page.getByRole("button", { name: "Copy selected", exact: true }).last().click();

    await expect(page.getByText("Copied 1 entry to " + expectedDateLabel(target))).toBeVisible();
    const copies = (await entriesForUser(user.id)).filter((r) => r.consumed_local_date === target);
    expect(copies.map((c) => c.name)).toEqual(["QA8b Stale Keep"]);
  });
});

// =============================================================================================
// 3. Save selected as a meal (row to hammer: source rows byte-identical)
// =============================================================================================

test.describe("Phase8b QA: Save selected as a meal", () => {
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

  test("saves EXACTLY the ticked cross-group set as one meal, chronologically ordered, with matching totals, leaving the source entries byte-identical", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8b Sel Oats", quantity: 1.75, unit: "bowl", caloriesPerUnit: 205.33, proteinGPerUnit: 7.11, consumedAt: todayAt("07:00") },
      { name: "QA8b Sel Skip", caloriesPerUnit: 999, proteinGPerUnit: 99, consumedAt: todayAt("07:00") },
      { name: "QA8b Sel Chicken", quantity: 2.5, unit: "oz", caloriesPerUnit: 165.55, proteinGPerUnit: 31.02, consumedAt: todayAt("13:30") },
    ]);
    await page.goto("/food");
    const sourcesBefore = await entriesForUser(user.id);

    await enterSelectMode(page);
    await checkboxFor(page, "QA8b Sel Oats").check();
    await checkboxFor(page, "QA8b Sel Chicken").check();
    await page.getByRole("button", { name: "Save selected as a meal" }).click();

    // The name field must open BLANK (Jeff overrode the prefill recommendation -- Phase 7b).
    const nameField = page.getByLabel("Meal name");
    await expect(nameField).toHaveValue("");
    await nameField.fill("QA8b Cross-group meal");
    await page.getByRole("button", { name: "Save meal" }).click();

    await expect(page.getByText('Saved as "QA8b Cross-group meal".')).toBeVisible();

    const meals = await mealsForUser(user.id);
    expect(meals).toHaveLength(1);
    const items = await itemsForMeal(meals[0].id);
    // Exactly the ticked set -- the untouched group-mate must NOT be in the meal.
    expect(items.map((i) => i.name)).toEqual(["QA8b Sel Oats", "QA8b Sel Chicken"]);
    expect(items.map((i) => i.sort_order)).toEqual([0, 1]);

    // Per-row generated-column equality proves the SAME round(quantity * per_unit) expression ran
    // on both sides, rather than a total having been copied across.
    const oats = sourcesBefore.find((e) => e.name === "QA8b Sel Oats");
    const chicken = sourcesBefore.find((e) => e.name === "QA8b Sel Chicken");
    expect(items[0].calories).toBe(oats!.calories);
    expect(items[0].protein_g).toBe(oats!.protein_g);
    expect(items[0].quantity).toBe(oats!.quantity);
    expect(items[0].unit).toBe(oats!.unit);
    expect(items[0].calories_per_unit).toBe(oats!.calories_per_unit);
    expect(items[1].calories).toBe(chicken!.calories);
    expect(items[1].protein_g).toBe(chicken!.protein_g);
    expect(items.reduce((s, i) => s + i.calories, 0)).toBe(oats!.calories + chicken!.calories);

    // The Phase 7b read-only invariant must hold with a SELECTION as the source, not just a group:
    // whole-row deep equality catches any field a per-field assertion would miss.
    const sourcesAfter = await entriesForUser(user.id);
    expect(sourcesAfter).toEqual(sourcesBefore);
    for (const s of sourcesAfter) {
      expect(s.logged_from_meal_id).toBeNull();
    }
  });

  test("a successful bulk save clears the selection and exits select mode", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8b BS1", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("06:00") },
      { name: "QA8b BS2", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("20:00") },
    ]);
    await page.goto("/food");
    await enterSelectMode(page);
    await checkboxFor(page, "QA8b BS1").check();
    await checkboxFor(page, "QA8b BS2").check();
    await page.getByRole("button", { name: "Save selected as a meal" }).click();
    await page.getByLabel("Meal name").fill("QA8b Spent meal");
    await page.getByRole("button", { name: "Save meal" }).click();

    await expect(page.getByText('Saved as "QA8b Spent meal".')).toBeVisible();
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(page.getByText(/^\d+ selected$/)).toHaveCount(0);
    await expect(page.getByLabel("Meal name")).toHaveCount(0);
  });
});

// =============================================================================================
// 4. Refresh survival -- the row to hammer overall (this bug class has shipped twice in this repo)
// =============================================================================================

test.describe("Phase8b QA: selection survives a background refresh", () => {
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

  async function seedThree() {
    return seedEntries(client, user, [
      { name: "QA8b Surv A", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("08:30") },
      { name: "QA8b Surv B", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("17:30") },
      { name: "QA8b Surv Other", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("21:30") },
    ]);
  }

  async function armSelectionWithOpenSaveExpander(page: Page) {
    await enterSelectMode(page);
    await checkboxFor(page, "QA8b Surv A").check();
    await checkboxFor(page, "QA8b Surv B").check();
    await expect(page.getByText("2 selected")).toBeVisible();
    await page.getByRole("button", { name: "Save selected as a meal" }).click();
    await page.getByLabel("Meal name").fill("Partially typed na");
  }

  async function assertEverythingSurvived(page: Page) {
    await expect(page.getByText("2 selected")).toBeVisible();
    await expect(checkboxFor(page, "QA8b Surv A")).toBeChecked();
    await expect(checkboxFor(page, "QA8b Surv B")).toBeChecked();
    await expect(page.getByLabel("Meal name")).toBeVisible();
    await expect(page.getByLabel("Meal name")).toHaveValue("Partially typed na");
    // Still in select mode -- ordinary per-row actions remain hidden.
    await expect(page.getByRole("button", { name: "Log again" })).toHaveCount(0);
  }

  test("ADDING an unrelated entry (a real background refresh) leaves select mode, both ticks, the open expander and the typed name intact", async ({ page }) => {
    await seedThree();
    await page.goto("/food");
    await armSelectionWithOpenSaveExpander(page);

    await page.getByLabel("Name", { exact: true }).fill("QA8b Surv Trigger");
    await page.getByLabel("Total calories").fill("42");
    await page.getByLabel("Total protein (g)").fill("2");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Entry added.")).toBeVisible();
    await expect(row(page, "QA8b Surv Trigger")).toBeVisible();

    await assertEverythingSurvived(page);
  });

  test("DELETING an unselected entry (the other refresh trigger) leaves select mode, both ticks, the open expander and the typed name intact", async ({ page }) => {
    const seeded = await seedThree();
    await page.goto("/food");
    await armSelectionWithOpenSaveExpander(page);

    // Delete the UNSELECTED entry out-of-band, then force the day to refetch via an add. (In
    // select mode the per-row Delete button is deliberately hidden, so an out-of-band delete plus
    // a refresh trigger is the only way to reach this state -- which is itself the point.)
    const admin = createAdminClient();
    const other = seeded.find((e) => e.name === "QA8b Surv Other");
    await admin.from("food_entries").delete().eq("id", other!.id);

    await page.getByLabel("Name", { exact: true }).fill("QA8b Surv Trigger2");
    await page.getByLabel("Total calories").fill("11");
    await page.getByLabel("Total protein (g)").fill("1");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Entry added.")).toBeVisible();
    await expect(row(page, "QA8b Surv Other")).toHaveCount(0);

    await assertEverythingSurvived(page);
  });

  test("N-3 and refresh-survival TOGETHER: an open bulk COPY expander keeps its picked target date across a background refresh", async ({ page }) => {
    const target = utcDateOffset(-7);
    await seedThree();
    await page.goto("/food");
    await enterSelectMode(page);
    await checkboxFor(page, "QA8b Surv A").check();
    await page.getByRole("button", { name: "Copy selected" }).click();
    await page.getByLabel("Copy to date").fill(target);
    await page.getByLabel("Copy to time").selectOption("06:30");

    await page.getByLabel("Name", { exact: true }).fill("QA8b Surv Trigger3");
    await page.getByLabel("Total calories").fill("7");
    await page.getByLabel("Total protein (g)").fill("0");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Entry added.")).toBeVisible();

    // An unmount keyed off anything a refresh changes would pass the stale-error rows below and
    // fail THIS one -- which is exactly why the design doc requires them asserted together.
    await expect(page.getByLabel("Copy to date")).toBeVisible();
    await expect(page.getByLabel("Copy to date")).toHaveValue(target);
    await expect(page.getByLabel("Copy to time")).toHaveValue("06:30");
    await expect(page.getByText("1 selected")).toBeVisible();
  });

  test("the bulk expander is a SIBLING of the entry form, not nested inside it -- Save actually submits (the Phase 6 nested-form class)", async ({ page }) => {
    await seedThree();
    await page.goto("/food");
    await enterSelectMode(page);
    await checkboxFor(page, "QA8b Surv A").check();
    await page.getByRole("button", { name: "Save selected as a meal" }).click();
    await page.getByLabel("Meal name").fill("QA8b Nested check");
    await page.getByRole("button", { name: "Save meal" }).click();

    // A nested <form> would have submitted the OUTER food-entry form instead; the meal row landing
    // in the database is the only proof that cannot be faked by reading the JSX.
    await expect(page.getByText('Saved as "QA8b Nested check".')).toBeVisible();
    const meals = await mealsForUser(user.id);
    expect(meals.map((m) => m.name)).toEqual(["QA8b Nested check"]);
  });
});

// =============================================================================================
// 5. N-3: no stale error / stale picked date on reopen
// =============================================================================================

test.describe("Phase8b QA: N-3 expander state does not survive a close/reopen", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
    await seedEntries(client, user, [
      { name: "QA8b N3 One", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("09:45") },
      { name: "QA8b N3 Two", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("15:45") },
    ]);
    await page.goto("/food");
    await expect(row(page, "QA8b N3 One")).toBeVisible();
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  const errorText = /You can.t copy to a date later than today/;

  test("CopyDayDialog: a rejected copy leaves no stale error and no stale target date on reopen", async ({ page }) => {
    const future = utcDateOffset(2);
    await page.getByRole("button", { name: "Copy this day" }).click();
    await stripMax(page, "#copy-day-target-date");
    await page.getByLabel("Copy to date").fill(future);
    await page.getByRole("button", { name: "Copy day" }).click();
    await expect(page.getByText(errorText)).toBeVisible();

    await page.getByRole("button", { name: "Close" }).click();
    await expect(page.getByLabel("Copy to date")).toHaveCount(0);

    await page.getByRole("button", { name: "Copy this day" }).click();
    // No error text at all, before any new action -- and the date is back to its default (today).
    await expect(page.getByText(errorText)).toHaveCount(0);
    await expect(page.getByLabel("Copy to date")).toHaveValue(todayUtc());
  });

  test("CopyDayDialog: reopening after a SUCCESSFUL copy is also clean", async ({ page }) => {
    const target = utcDateOffset(-8);
    await page.getByRole("button", { name: "Copy this day" }).click();
    await page.getByLabel("Copy to date").fill(target);
    await page.getByRole("button", { name: "Copy day" }).click();
    await expect(page.getByText("Copied 2 entries to " + expectedDateLabel(target))).toBeVisible();

    await page.getByRole("button", { name: "Copy this day" }).click();
    await expect(page.getByText(errorText)).toHaveCount(0);
    await expect(page.getByLabel("Copy to date")).toHaveValue(todayUtc());
  });

  test("the bulk COPY expander follows the same rule -- cancel and reopen is a fresh panel", async ({ page }) => {
    const future = utcDateOffset(2);
    await enterSelectMode(page);
    await checkboxFor(page, "QA8b N3 One").check();
    await page.getByRole("button", { name: "Copy selected" }).click();
    await stripMax(page, "#copy-group-target-date");
    await page.getByLabel("Copy to date").fill(future);
    await page.getByLabel("Copy to time").selectOption("09:00");
    await page.getByRole("button", { name: "Copy selected", exact: true }).last().click();
    await expect(page.getByText(errorText)).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByLabel("Copy to date")).toHaveCount(0);

    await page.getByRole("button", { name: "Copy selected" }).click();
    await expect(page.getByText(errorText)).toHaveCount(0);
    await expect(page.getByLabel("Copy to date")).toHaveValue(todayUtc());
    await expect(page.getByLabel("Copy to time")).toHaveValue("");
  });

  test("the group COPY expander follows the same rule", async ({ page }) => {
    const future = utcDateOffset(2);
    const group = page.locator("section").filter({ hasText: "QA8b N3 One" });
    await group.getByRole("button", { name: "Copy this group" }).click();
    await stripMax(page, "#copy-group-target-date");
    await group.getByLabel("Copy to date").fill(future);
    await group.getByRole("button", { name: "Copy group" }).click();
    await expect(group.getByText(errorText)).toBeVisible();

    await group.getByRole("button", { name: "Cancel" }).last().click();
    await group.getByRole("button", { name: "Copy this group" }).click();
    await expect(group.getByText(errorText)).toHaveCount(0);
    await expect(group.getByLabel("Copy to date")).toHaveValue(todayUtc());
  });
});

// =============================================================================================
// 6. N-4: "Log again" names its destination when it is not the day on screen
// =============================================================================================

test.describe("Phase8b QA: N-4 Log again destination", () => {
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

  test("from a PAST day: the row is written to TODAY, the toast names the destination in MM/DD/YYYY, and the view stays on the past day", async ({ page }) => {
    const past = utcDateOffset(-9);
    await seedEntries(client, user, [
      { name: "QA8b LA Past", quantity: 2, unit: "slice", caloriesPerUnit: 90, proteinGPerUnit: 3, consumedAt: dayAt(past, "12:15") },
    ]);
    await page.goto("/food");
    await gotoDay(page, past, "QA8b LA Past");
    await expect(row(page, "QA8b LA Past")).toBeVisible();

    await page.getByRole("button", { name: "Log again" }).click();

    // The behaviour itself is unchanged and must stay correct: the row lands on TODAY.
    await expect(page.getByText(expectedDateLabel(todayUtc()))).toBeVisible();
    const all = await entriesForUser(user.id);
    const copies = all.filter((r) => r.consumed_local_date === todayUtc());
    expect(copies).toHaveLength(1);
    expect(copies[0].name).toBe("QA8b LA Past");
    expect(copies[0].logged_from_meal_id).toBeNull();

    // The toast names the destination -- and does so FORMATTED, never raw ISO.
    const status = page.locator('[role="status"]');
    await expect(status).toContainText("QA8b LA Past");
    await expect(status).toContainText(expectedDateLabel(todayUtc()));
    await expect(status).not.toContainText(todayUtc());

    // The view deliberately STAYS on the browsed day -- navigating was rejected.
    await expect(page.locator("#food-day")).toHaveValue(past);
    await expect(row(page, "QA8b LA Past")).toHaveCount(1);
  });

  test("from TODAY: the toast does NOT redundantly name the destination", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8b LA Today", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("10:00") },
    ]);
    await page.goto("/food");
    await expect(row(page, "QA8b LA Today")).toBeVisible();

    await page.getByRole("button", { name: "Log again" }).first().click();
    const status = page.locator('[role="status"]');
    await expect(status).toContainText("QA8b LA Today");
    await expect(status).not.toContainText(expectedDateLabel(todayUtc()));
    await expect(page.locator("#food-day")).toHaveValue(todayUtc());
  });
});

// =============================================================================================
// 7. Editing-row highlight
// =============================================================================================

test.describe("Phase8b QA: editing-row highlight", () => {
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

  async function seedFour() {
    return seedEntries(client, user, [
      { name: "QA8b Ed One", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("07:15") },
      { name: "QA8b Ed Two", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("11:15") },
      { name: "QA8b Ed Three", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("15:15") },
      { name: "QA8b Ed Four", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("19:15") },
    ]);
  }

  test("exactly the row being edited is marked, by a VISIBLE 'Editing' label (not colour alone) plus a left accent bar", async ({ page }) => {
    await seedFour();
    await page.goto("/food");
    await row(page, "QA8b Ed Three").getByRole("button", { name: "Edit" }).click();

    // Exactly one row is marked, and it is the right one.
    await expect(page.getByText("Editing", { exact: true })).toHaveCount(1);
    await expect(row(page, "QA8b Ed Three").getByText("Editing", { exact: true })).toBeVisible();
    for (const other of ["QA8b Ed One", "QA8b Ed Two", "QA8b Ed Four"]) {
      await expect(row(page, other).getByText("Editing", { exact: true })).toHaveCount(0);
    }

    // The treatment is a left accent bar with NO surface fill (a sage-pale fill was rejected --
    // it would swallow the "From a saved meal" badge, which uses that same fill).
    await settle(page);
    const styles = await row(page, "QA8b Ed Three").evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        borderLeftWidth: cs.borderLeftWidth,
        borderLeftColor: cs.borderLeftColor,
        backgroundColor: cs.backgroundColor,
      };
    });
    expect(styles.borderLeftWidth).toBe("4px");
    // --accent is #1D4ED8 (2026-08-09/10, Phase 8i -- was --sage-deep #5C7444).
    expect(styles.borderLeftColor).toBe("rgb(29, 78, 216)");
    // Transparent (inherits the card surface) -- i.e. no fill of its own.
    expect(styles.backgroundColor).toBe("rgba(0, 0, 0, 0)");
  });

  test("the highlight clears on save, on cancel, and on a day change", async ({ page }) => {
    await seedFour();
    await page.goto("/food");

    // Cancel.
    await row(page, "QA8b Ed One").getByRole("button", { name: "Edit" }).click();
    await expect(page.getByText("Editing", { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Editing", { exact: true })).toHaveCount(0);

    // Save.
    await row(page, "QA8b Ed Two").getByRole("button", { name: "Edit" }).click();
    await expect(page.getByText("Editing", { exact: true })).toHaveCount(1);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Changes saved.")).toBeVisible();
    await expect(page.getByText("Editing", { exact: true })).toHaveCount(0);

    // Day change.
    await row(page, "QA8b Ed Four").getByRole("button", { name: "Edit" }).click();
    await expect(page.getByText("Editing", { exact: true })).toHaveCount(1);
    await gotoDay(page, utcDateOffset(-10));
    await expect(page.getByText("Editing", { exact: true })).toHaveCount(0);
  });

  test("the highlight SURVIVES a background refresh -- the id-vs-object-identity trap", async ({ page }) => {
    const seeded = await seedFour();
    await page.goto("/food");
    await row(page, "QA8b Ed Three").getByRole("button", { name: "Edit" }).click();
    await expect(page.getByText("Editing", { exact: true })).toHaveCount(1);

    // Delete two DIFFERENT entries out-of-band via the admin client (deliberately not the UI's own
    // row-level Delete -- this test's subject is a background refresh triggered by SOMETHING ELSE,
    // "Log again" below, not the delete path itself) and force a real refresh through the app via a
    // different row's "Log again". refresh() replaces every entry object; an implementation
    // comparing objects rather than ids silently stops matching here.
    const admin = createAdminClient();
    const four = seeded.find((e) => e.name === "QA8b Ed Four");
    const one = seeded.find((e) => e.name === "QA8b Ed One");
    await admin.from("food_entries").delete().eq("id", four!.id);
    await admin.from("food_entries").delete().eq("id", one!.id);
    await row(page, "QA8b Ed Two").getByRole("button", { name: "Log again" }).click();
    await expect(page.getByText(/Logged .QA8b Ed Two. again/)).toBeVisible();
    await expect(row(page, "QA8b Ed One")).toHaveCount(0);
    await expect(row(page, "QA8b Ed Four")).toHaveCount(0);

    await expect(page.getByText("Editing", { exact: true })).toHaveCount(1);
    await expect(row(page, "QA8b Ed Three").getByText("Editing", { exact: true })).toBeVisible();
  });

  test("the edited row hides its own Log again/Edit while other rows keep theirs, and Log again on another row still works without cancelling the edit", async ({ page }) => {
    await seedFour();
    await page.goto("/food");
    await row(page, "QA8b Ed Two").getByRole("button", { name: "Edit" }).click();

    // 2026-08-07 (Phase 8g): "Delete" is back on the row as a third icon-only action -- it's
    // suppressed on the edited row exactly like Log again/Edit (all three live in the same
    // conditional), and the edit form no longer has a Delete control of its own at all.
    const edited = row(page, "QA8b Ed Two");
    await expect(edited.getByRole("button", { name: "Log again" })).toHaveCount(0);
    await expect(edited.getByRole("button", { name: "Edit" })).toHaveCount(0);
    await expect(edited.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete entry" })).toHaveCount(0);

    const other = row(page, "QA8b Ed Three");
    await expect(other.getByRole("button", { name: "Log again" })).toHaveCount(1);
    await expect(other.getByRole("button", { name: "Edit" })).toHaveCount(1);
    await expect(other.getByRole("button", { name: "Delete" })).toHaveCount(1);

    // Type into the open edit form, then use an unrelated row's "Log again": the edit must survive.
    await page.getByLabel("Name", { exact: true }).fill("QA8b Ed Two RENAMED");
    await other.getByRole("button", { name: "Log again" }).click();
    await expect(page.getByText(/Logged .QA8b Ed Three. again/)).toBeVisible();

    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("QA8b Ed Two RENAMED");
    await expect(page.getByText("Editing", { exact: true })).toHaveCount(1);
  });

  test("a 'From a saved meal' badge on the edited row stays legible (the collision the no-fill decision exists to avoid)", async ({ page }) => {
    // Build a real saved meal and log it, so the row genuinely carries logged_from_meal_id.
    const { data: meal } = await client
      .from("meals")
      .insert({ user_id: user.id, name: "QA8b Badge meal" })
      .select()
      .single();
    await client.from("meal_items").insert({
      user_id: user.id,
      meal_id: meal.id,
      name: "QA8b Badge item",
      quantity: 1,
      calories_per_unit: 150,
      protein_g_per_unit: 9,
      sort_order: 0,
    });

    await page.goto("/food");
    await page.getByRole("button", { name: "Log a saved meal" }).click();
    // { exact: true } (Phase 8f): the open picker is now wrapped in an `ActionPanel` whose
    // accessible name ("Log a saved meal") contains "Meal" as a substring -- an unscoped
    // getByLabel("Meal") would also match that region (see ai-context/DECISIONS.md's "Copy to
    // time does not avoid a Playwright getByLabel collision..." entry for the same class of bug).
    await page.getByLabel("Meal", { exact: true }).selectOption({ index: 1 });
    await page.getByRole("button", { name: "Log meal" }).click();
    await expect(page.getByText("Meal logged.")).toBeVisible();

    const badgeRow = row(page, "QA8b Badge item");
    await expect(badgeRow.getByText("From a saved meal")).toBeVisible();

    await badgeRow.getByRole("button", { name: "Edit" }).click();
    await expect(badgeRow.getByText("Editing", { exact: true })).toBeVisible();
    const badge = badgeRow.getByText("From a saved meal");
    await expect(badge).toBeVisible();

    // Still a PILL on an accent-soft fill, with ink text -- unchanged by the edit state, and the
    // row behind it still has no fill of its own, so the badge cannot vanish into it.
    const badgeStyles = await badge.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, radius: cs.borderRadius, color: cs.color };
    });
    // --accent-soft is #DBEAFE (2026-08-09/10, Phase 8i -- was --sage-pale #E3EAD6).
    expect(badgeStyles.bg).toBe("rgb(219, 234, 254)");
    expect(isPillRadius(badgeStyles.radius)).toBe(true);
    await settle(page);
    const rowBg = await badgeRow.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(rowBg).not.toBe(badgeStyles.bg);
  });

  test("editing and select mode COEXIST: entering select mode does not cancel the edit, and the edited row shows both its highlight and a checkbox", async ({ page }) => {
    await seedFour();
    await page.goto("/food");
    await row(page, "QA8b Ed Two").getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Name", { exact: true }).fill("QA8b Ed Two TYPED");

    await enterSelectMode(page);

    // The edit is NOT cancelled and the typed value is NOT discarded.
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
    await expect(page.getByLabel("Name", { exact: true })).toHaveValue("QA8b Ed Two TYPED");

    const edited = row(page, "QA8b Ed Two");
    await expect(edited.getByText("Editing", { exact: true })).toBeVisible();
    await expect(edited.getByRole("checkbox")).toHaveCount(1);

    // A CHECKED row still gets no tint of its own -- the checkbox alone is the indicator, so the
    // two per-row visual states stay distinguishable.
    await edited.getByRole("checkbox").check();
    await settle(page);
    const bg = await edited.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(bg).toBe("rgba(0, 0, 0, 0)");
    await expect(page.getByText("1 selected")).toBeVisible();
  });

  test("no live region is introduced for entering edit mode (deliberate), while the 'Editing' text is real content", async ({ page }) => {
    await seedFour();
    await page.goto("/food");
    // Wait for the list to actually render before taking the baseline -- Next's own dev overlay
    // mounts its own aria-live region asynchronously, which would otherwise skew the count.
    await expect(row(page, "QA8b Ed Two")).toBeVisible();
    const liveRegions = page.locator('main [role="status"], main [aria-live]');
    const statusesBefore = await liveRegions.count();

    await row(page, "QA8b Ed Two").getByRole("button", { name: "Edit" }).click();
    await expect(page.getByText("Editing", { exact: true })).toBeVisible();

    await page.waitForTimeout(400);
    const statusesAfter = await liveRegions.count();
    expect(statusesAfter).toBe(statusesBefore);
    // The label is ordinary text content, available to assistive tech without an announcement.
    const marked = row(page, "QA8b Ed Two");
    await expect(marked).toHaveAttribute("aria-current", "true");
  });
});

// =============================================================================================
// 8. Optional "Copy to time" override
// =============================================================================================

test.describe("Phase8b QA: Copy to time override", () => {
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

  test("the sentinel is the DEFAULT and preserves the group time exactly (current behaviour is the default behaviour)", async ({ page }) => {
    const target = utcDateOffset(-11);
    await seedEntries(client, user, [
      { name: "QA8b TO Keep1", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("08:45") },
      { name: "QA8b TO Keep2", caloriesPerUnit: 150, proteinGPerUnit: 7, consumedAt: todayAt("08:45") },
    ]);
    await page.goto("/food");
    const group = page.locator("section").filter({ hasText: "QA8b TO Keep1" });
    await group.getByRole("button", { name: "Copy this group" }).click();

    const timeSelect = group.getByLabel("Copy to time");
    await expect(timeSelect).toHaveValue("");
    await expect(timeSelect.locator("option").first()).toHaveText("Keep original time");

    await group.getByLabel("Copy to date").fill(target);
    await group.getByRole("button", { name: "Copy group" }).click();
    await expect(page.getByText("Copied 2 entries to " + expectedDateLabel(target))).toBeVisible();

    const copies = (await entriesForUser(user.id)).filter((r) => r.consumed_local_date === target);
    expect(copies).toHaveLength(2);
    expect(new Set(copies.map((c) => c.consumed_at)).size).toBe(1);
    expect(copies[0].consumed_at.slice(11, 16)).toBe("08:45");
  });

  test("an explicit time is applied to EVERY copied row and they form one group", async ({ page }) => {
    const target = utcDateOffset(-12);
    await seedEntries(client, user, [
      { name: "QA8b TO Set1", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("08:45") },
      { name: "QA8b TO Set2", caloriesPerUnit: 150, proteinGPerUnit: 7, consumedAt: todayAt("08:45") },
    ]);
    await page.goto("/food");
    const group = page.locator("section").filter({ hasText: "QA8b TO Set1" });
    await group.getByRole("button", { name: "Copy this group" }).click();
    await group.getByLabel("Copy to date").fill(target);
    await group.getByLabel("Copy to time").selectOption("18:30");
    await group.getByRole("button", { name: "Copy group" }).click();
    await expect(page.getByText("Copied 2 entries to " + expectedDateLabel(target))).toBeVisible();

    const copies = (await entriesForUser(user.id)).filter((r) => r.consumed_local_date === target);
    expect(copies).toHaveLength(2);
    expect(new Set(copies.map((c) => c.consumed_at)).size).toBe(1);
    expect(normalizeInstant(copies[0].consumed_at)).toBe(normalizeInstant(dayAt(target, "18:30")));
  });

  test("a single-group copy shows NO collapse note in either mode (nothing to disclose)", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8b TO Solo1", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("10:15") },
      { name: "QA8b TO Solo2", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("10:15") },
    ]);
    await page.goto("/food");
    const group = page.locator("section").filter({ hasText: "QA8b TO Solo1" });
    await group.getByRole("button", { name: "Copy this group" }).click();

    await expect(group.getByText(/single meal group/)).toHaveCount(0);
    await expect(group.getByText(/keeps its own time of day/)).toHaveCount(0);
    await group.getByLabel("Copy to time").selectOption("12:00");
    await expect(group.getByText(/single meal group/)).toHaveCount(0);
  });

  test("a cross-group selection discloses the collapse before submission, and an explicit time collapses three groups into one", async ({ page }) => {
    const target = utcDateOffset(-13);
    await seedEntries(client, user, [
      { name: "QA8b TO G1", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("07:00") },
      { name: "QA8b TO G2", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("12:00") },
      { name: "QA8b TO G3", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("18:00") },
    ]);
    await page.goto("/food");
    await enterSelectMode(page);
    await checkboxFor(page, "QA8b TO G1").check();
    await checkboxFor(page, "QA8b TO G2").check();
    await checkboxFor(page, "QA8b TO G3").check();
    await page.getByRole("button", { name: "Copy selected" }).click();

    await expect(page.getByLabel("Copy to time").locator("option").first()).toHaveText("Keep original times");
    await expect(page.getByText("Each entry keeps its own time of day.")).toBeVisible();

    await page.getByLabel("Copy to date").fill(target);
    await page.getByLabel("Copy to time").selectOption("18:30");
    await expect(page.getByText(/All 3 entries will be copied to 06:30 PM as a single meal group/)).toBeVisible();

    await page.getByRole("button", { name: "Copy selected", exact: true }).last().click();
    await expect(page.getByText("Copied 3 entries to " + expectedDateLabel(target))).toBeVisible();

    const copies = (await entriesForUser(user.id)).filter((r) => r.consumed_local_date === target);
    expect(copies).toHaveLength(3);
    expect(new Set(copies.map((c) => c.consumed_at)).size).toBe(1);
    expect(normalizeInstant(copies[0].consumed_at)).toBe(normalizeInstant(dayAt(target, "18:30")));
  });

  test("with the sentinel, the same cross-group selection lands as THREE groups and the collapse note is absent", async ({ page }) => {
    const target = utcDateOffset(-14);
    await seedEntries(client, user, [
      { name: "QA8b TO S1", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("07:00") },
      { name: "QA8b TO S2", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("12:00") },
      { name: "QA8b TO S3", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("18:00") },
    ]);
    await page.goto("/food");
    await enterSelectMode(page);
    await checkboxFor(page, "QA8b TO S1").check();
    await checkboxFor(page, "QA8b TO S2").check();
    await checkboxFor(page, "QA8b TO S3").check();
    await page.getByRole("button", { name: "Copy selected" }).click();
    await page.getByLabel("Copy to date").fill(target);
    await expect(page.getByText(/single meal group/)).toHaveCount(0);
    await page.getByRole("button", { name: "Copy selected", exact: true }).last().click();
    await expect(page.getByText("Copied 3 entries to " + expectedDateLabel(target))).toBeVisible();

    const copies = (await entriesForUser(user.id)).filter((r) => r.consumed_local_date === target);
    expect(copies).toHaveLength(3);
    expect(new Set(copies.map((c) => c.consumed_at)).size).toBe(3);
    expect(copies.map((c) => c.consumed_at.slice(11, 16)).sort()).toEqual(["07:00", "12:00", "18:00"]);
  });

  test("the control offers exactly the 96 quarter-hour values plus the sentinel, and cannot express an off-grid time", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8b TO Opts", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("09:00") },
    ]);
    await page.goto("/food");
    const group = page.locator("section").filter({ hasText: "QA8b TO Opts" });
    await group.getByRole("button", { name: "Copy this group" }).click();

    const options = group.getByLabel("Copy to time").locator("option");
    await expect(options).toHaveCount(97);
    const values = await options.evaluateAll((els) => els.map((e) => (e as HTMLOptionElement).value));
    expect(values[0]).toBe("");
    const grid = values.slice(1);
    expect(grid).toHaveLength(96);
    expect(grid[0]).toBe("00:00");
    expect(grid[95]).toBe("23:45");
    expect(grid.every((v) => Number(v.slice(3)) % 15 === 0)).toBe(true);
    expect(new Set(grid).size).toBe(96);
  });

  test("CopyDayDialog has NO time control at all (an explicit non-goal), and still preserves each source time of day", async ({ page }) => {
    const target = utcDateOffset(-15);
    await seedEntries(client, user, [
      { name: "QA8b Day Morning", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("06:45") },
      { name: "QA8b Day Evening", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("20:15") },
    ]);
    await page.goto("/food");
    await page.getByRole("button", { name: "Copy this day" }).click();

    await expect(page.getByLabel("Copy to time")).toHaveCount(0);
    await page.getByLabel("Copy to date").fill(target);
    await page.getByRole("button", { name: "Copy day" }).click();
    await expect(page.getByText("Copied 2 entries to " + expectedDateLabel(target))).toBeVisible();

    const copies = (await entriesForUser(user.id)).filter((r) => r.consumed_local_date === target);
    expect(copies.map((c) => c.consumed_at.slice(11, 16)).sort()).toEqual(["06:45", "20:15"]);
  });
});

// =============================================================================================
// 9. Transient success feedback (StatusMessage) -- banner, not pill; the two status pills stay
// =============================================================================================

test.describe("Phase8b QA: StatusMessage", () => {
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

  async function addEntry(page: Page, name: string, kcal: string) {
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Total calories").fill(kcal);
    await page.getByLabel("Total protein (g)").fill("1");
    await page.getByRole("button", { name: "Add entry" }).click();
  }

  test("the confirmation is an announced, full-width, left-accent BANNER -- asserted on COMPUTED styles, not source classes", async ({ page }) => {
    await page.goto("/food");
    await addEntry(page, "QA8b SM One", "100");

    const banner = page.locator('[role="status"]').filter({ hasText: "Entry added." });
    await expect(banner).toBeVisible();

    const s = await banner.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        radius: cs.borderTopLeftRadius,
        borderLeftWidth: cs.borderLeftWidth,
        borderLeftColor: cs.borderLeftColor,
        background: cs.backgroundColor,
        color: cs.color,
        fontSize: cs.fontSize,
        paddingLeft: cs.paddingLeft,
        width: el.getBoundingClientRect().width,
        parentWidth: (el.parentElement as HTMLElement).getBoundingClientRect().width,
      };
    });
    // Not a pill: a pill is rounded-full (9999px) at text-xs.
    expect(isPillRadius(s.radius)).toBe(false);
    expect(s.fontSize).toBe("14px");
    expect(s.borderLeftWidth).toBe("4px");
    // accent bar, accent-soft surface, ink text (2026-08-09/10, Phase 8i -- was sage-deep/
    // sage-pale/the old ink) -- the recorded contrast guardrail: accent is used ONLY as a
    // non-text element here.
    expect(s.borderLeftColor).toBe("rgb(29, 78, 216)");
    expect(s.background).toBe("rgb(219, 234, 254)");
    expect(s.color).toBe("rgb(15, 23, 42)");
    expect(s.paddingLeft).toBe("16px");
    expect(Math.round(s.width)).toBe(Math.round(s.parentWidth));
  });

  test("no descendant of the banner renders accent TEXT on the accent-soft tint (the old ~4.2:1 trap this token swap dissolved, but the RULE is kept anyway)", async ({ page }) => {
    await page.goto("/food");
    await addEntry(page, "QA8b SM Contrast", "100");
    const banner = page.locator('[role="status"]').filter({ hasText: "Entry added." });
    await expect(banner).toBeVisible();

    const textColors = await banner.evaluate((el) => {
      const out: string[] = [];
      const walk = (n: Element) => {
        const hasText = Array.from(n.childNodes).some(
          (c) => c.nodeType === 3 && (c.textContent ?? "").trim().length > 0,
        );
        if (hasText) out.push(getComputedStyle(n).color);
        Array.from(n.children).forEach(walk);
      };
      walk(el);
      return out;
    });
    expect(textColors.length).toBeGreaterThan(0);
    for (const c of textColors) {
      expect(c).toBe("rgb(15, 23, 42)");
    }
  });

  test("the two STATUS pills are untouched -- FoodEntryList badge and MetricForm 'Already logged'", async ({ page }) => {
    // FoodEntryList badge, via a real logged meal.
    const { data: meal } = await client
      .from("meals")
      .insert({ user_id: user.id, name: "QA8b Pill meal" })
      .select()
      .single();
    await client.from("meal_items").insert({
      user_id: user.id,
      meal_id: meal.id,
      name: "QA8b Pill item",
      quantity: 1,
      calories_per_unit: 120,
      protein_g_per_unit: 5,
      sort_order: 0,
    });
    await page.goto("/food");
    await page.getByRole("button", { name: "Log a saved meal" }).click();
    // { exact: true } (Phase 8f): the open picker is now wrapped in an `ActionPanel` whose
    // accessible name ("Log a saved meal") contains "Meal" as a substring -- an unscoped
    // getByLabel("Meal") would also match that region (see ai-context/DECISIONS.md's "Copy to
    // time does not avoid a Playwright getByLabel collision..." entry for the same class of bug).
    await page.getByLabel("Meal", { exact: true }).selectOption({ index: 1 });
    await page.getByRole("button", { name: "Log meal" }).click();
    const badge = page.getByText("From a saved meal");
    await expect(badge).toBeVisible();
    const badgeStyles = await badge.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { radius: cs.borderTopLeftRadius, fontSize: cs.fontSize, role: el.getAttribute("role") };
    });
    expect(isPillRadius(badgeStyles.radius)).toBe(true);
    expect(badgeStyles.fontSize).toBe("12px");
    expect(badgeStyles.role).toBeNull();

    // MetricForm "Already logged ..." status pill.
    await client.from("daily_metrics").insert({
      user_id: user.id,
      metric_date: todayUtc(),
      weight_kg: 80,
    });
    await page.goto("/metrics");
    const alreadyLogged = page.getByText(/Already logged/);
    await expect(alreadyLogged).toBeVisible();
    const metricPill = await alreadyLogged.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { radius: cs.borderTopLeftRadius, fontSize: cs.fontSize, role: el.getAttribute("role") };
    });
    expect(isPillRadius(metricPill.radius)).toBe(true);
    expect(metricPill.fontSize).toBe("12px");
    expect(metricPill.role).toBeNull();
  });

  test("MetricForm gains a real 'Weight saved.' confirmation using the same banner (it had none before)", async ({ page }) => {
    await page.goto("/metrics");
    await page.getByLabel(/Weight/).fill("81.5");
    await page.getByRole("button", { name: /Log entry|Save changes/ }).click();

    const banner = page.locator('[role="status"]').filter({ hasText: "Weight saved." });
    await expect(banner).toBeVisible();
    const radius = await banner.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(isPillRadius(radius)).toBe(false);
  });

  test("/settings uses the identical treatment AND now auto-dismisses, without regressing the kg/lb radio", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel("Pounds (lb)").check();
    await page.getByRole("button", { name: /Save/ }).click();

    const banner = page.locator('[role="status"]').filter({ hasText: "Settings saved." });
    await expect(banner).toBeVisible();
    const s = await banner.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { radius: cs.borderTopLeftRadius, borderLeftWidth: cs.borderLeftWidth, fontSize: cs.fontSize };
    });
    expect(isPillRadius(s.radius)).toBe(false);
    expect(s.borderLeftWidth).toBe("4px");
    expect(s.fontSize).toBe("14px");

    // The recorded SettingsForm radio-desync bug must stay fixed: lb is still selected right after
    // the save settles (not snapped back), and survives a reload.
    await expect(page.getByLabel("Pounds (lb)")).toBeChecked();
    await page.reload();
    await expect(page.getByLabel("Pounds (lb)")).toBeChecked();

    // ... and it auto-dismisses now (it never did before).
    await page.getByRole("button", { name: /Save/ }).click();
    await expect(page.locator('[role="status"]').filter({ hasText: "Settings saved." })).toBeVisible();
    await page.waitForTimeout(7500);
    await expect(page.locator('[role="status"]').filter({ hasText: "Settings saved." })).toHaveCount(0);
  });

  test("auto-dismiss is about 6s: still visible at 5s, gone by 7.5s", async ({ page }) => {
    await page.goto("/food");
    await addEntry(page, "QA8b SM Timer", "100");
    const banner = page.locator('[role="status"]').filter({ hasText: "Entry added." });
    await expect(banner).toBeVisible();
    const shownAt = Date.now();

    await page.waitForTimeout(Math.max(0, 5000 - (Date.now() - shownAt)));
    await expect(banner).toBeVisible();
    await page.waitForTimeout(Math.max(0, 7500 - (Date.now() - shownAt)));
    await expect(banner).toHaveCount(0);
  });

  test("firing the IDENTICAL message twice gives the second occurrence a FULL fresh timer, not the remainder of the first", async ({ page }) => {
    await page.goto("/food");
    await addEntry(page, "QA8b SM Repeat A", "100");
    await expect(page.locator('[role="status"]').filter({ hasText: "Entry added." })).toBeVisible();

    // Let most of the first message window elapse, then fire the SAME message again.
    await page.waitForTimeout(4500);
    await addEntry(page, "QA8b SM Repeat B", "100");
    const banner = page.locator('[role="status"]').filter({ hasText: "Entry added." });
    await expect(banner).toBeVisible();
    const secondShownAt = Date.now();

    // Under the pre-fix behaviour (timer keyed on the message STRING) the second occurrence would
    // inherit roughly 1.5s of the first window and vanish almost immediately.
    await page.waitForTimeout(Math.max(0, 4500 - (Date.now() - secondShownAt)));
    await expect(banner).toBeVisible();
  });
});

// =============================================================================================
// 10. Human-readable date format -- no raw ISO in prose
// =============================================================================================

test.describe("Phase8b QA: MM/DD/YYYY date format", () => {
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

  test("CopyDayDialog names its SOURCE day formatted, and the copy toast names the TARGET formatted", async ({ page }) => {
    const past = utcDateOffset(-16);
    const target = utcDateOffset(-17);
    await seedEntries(client, user, [
      { name: "QA8b Fmt A", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: dayAt(past, "09:00") },
      { name: "QA8b Fmt B", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: dayAt(past, "13:00") },
    ]);
    await page.goto("/food");
    await gotoDay(page, past, "QA8b Fmt A");
    await expect(row(page, "QA8b Fmt A")).toBeVisible();

    await page.getByRole("button", { name: "Copy this day" }).click();
    const explain = page.getByText(/Copies all 2 entries from/);
    await expect(explain).toContainText(expectedDateLabel(past));
    await expect(explain).not.toContainText(past);

    await page.getByLabel("Copy to date").fill(target);
    await page.getByRole("button", { name: "Copy day" }).click();
    const toast = page.locator('[role="status"]');
    await expect(toast).toContainText("Copied 2 entries to " + expectedDateLabel(target));
    await expect(toast).not.toContainText(target);
  });

  test("no user-facing PROSE anywhere renders a bare YYYY-MM-DD (the actual reported defect)", async ({ page }) => {
    const past = utcDateOffset(-18);
    await seedEntries(client, user, [
      { name: "QA8b Sweep A", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("09:30") },
      { name: "QA8b Sweep B", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: dayAt(past, "09:30") },
    ]);
    await client.from("meals").insert({ user_id: user.id, name: "QA8b Sweep meal" });
    await client.from("daily_metrics").insert({ user_id: user.id, metric_date: todayUtc(), weight_kg: 80 });

    const isoInProse = /\d{4}-\d{2}-\d{2}/;
    for (const path of ["/food", "/meals", "/metrics", "/settings"]) {
      await page.goto(path);
      await page.waitForTimeout(600);
      const text = await page.locator("body").innerText();
      expect(text, path + " renders a bare ISO date in prose").not.toMatch(isoInProse);
    }

    // With every copy expander open too -- these are the surfaces that actually render dates.
    await page.goto("/food");
    await page.getByRole("button", { name: "Copy this day" }).click();
    await page.getByRole("button", { name: "Copy this group" }).click();
    const withPanels = await page.locator("body").innerText();
    expect(withPanels).not.toMatch(isoInProse);
  });

  test("the untouched set stays untouched: native date inputs still hold ISO values", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8b Iso Val", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("09:30") },
    ]);
    await page.goto("/food");
    await expect(page.locator("#food-day")).toHaveValue(todayUtc());
    await expect(page.getByLabel("Date")).toHaveValue(todayUtc());
    await page.getByRole("button", { name: "Copy this day" }).click();
    await expect(page.getByLabel("Copy to date")).toHaveValue(todayUtc());
  });
});

// =============================================================================================
// 11. Autofill hygiene (rendered attributes) + the getByLabel collision the doc claims is avoided
// =============================================================================================

test.describe("Phase8b QA: autofill hygiene and label collisions", () => {
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

  /** Every rendered control on the page, with its autocomplete attribute. */
  async function controlAttrs(page: Page) {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll("input, select, textarea")).map((el) => ({
        tag: el.tagName.toLowerCase(),
        type: (el as HTMLInputElement).type ?? "",
        name: (el as HTMLInputElement).name ?? "",
        id: el.id,
        ac: el.getAttribute("autocomplete"),
      })),
    );
  }

  test("login and signup carry the positive identity hints (email / current-password / new-password)", async ({ page, context }) => {
    await context.clearCookies();
    await page.goto("/login");
    await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "email");
    await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");
    await expect(page.locator("form")).toHaveAttribute("autocomplete", "off");

    await page.goto("/signup");
    await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "email");
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("autocomplete", "new-password");
    await expect(page.getByLabel("Confirm password")).toHaveAttribute("autocomplete", "new-password");
  });

  test("every control on /food (including all three expanders and the selection bar) is hinted autocomplete=off", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8b AC A", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("09:00") },
    ]);
    await page.goto("/food");
    // Open every surface that renders controls.
    await page.getByRole("button", { name: "Look up a food" }).click();
    await page.getByRole("button", { name: /Add detail/ }).click();
    await page.getByRole("button", { name: "Copy this day" }).click();
    await page.getByRole("button", { name: "Copy this group" }).click();
    await page.getByRole("button", { name: "Select entries" }).click();
    await checkboxFor(page, "QA8b AC A").check();
    await page.getByRole("button", { name: "Save selected as a meal" }).click();

    const controls = await controlAttrs(page);
    const unhinted = appControls(controls).filter((c) => c.ac !== "off");
    expect(unhinted, JSON.stringify(unhinted)).toEqual([]);
    expect(controls.length).toBeGreaterThan(10);

    const forms = await page.locator("form").evaluateAll((els) =>
      els.map((e) => e.getAttribute("autocomplete")),
    );
    expect(forms.filter((f) => f !== "off")).toEqual([]);
  });

  test("every control on /metrics, /settings and /trends is hinted autocomplete=off", async ({ page }) => {
    for (const path of ["/metrics", "/settings", "/trends"]) {
      await page.goto(path);
      await page.waitForTimeout(500);
      const controls = await controlAttrs(page);
      const unhinted = appControls(controls).filter((c) => c.ac !== "off");
      expect(unhinted, path + " " + JSON.stringify(unhinted)).toEqual([]);
      const forms = await page.locator("form").evaluateAll((els) =>
        els.map((e) => e.getAttribute("autocomplete")),
      );
      expect(forms.filter((f) => f !== "off"), path + " forms").toEqual([]);
    }
  });

  test("FIXED (was pinned as a FINDING): /meals controls are now swept -- the filter, meal name and item fields all carry autocomplete=off", async ({ page }) => {
    const { data: meal } = await client
      .from("meals")
      .insert({ user_id: user.id, name: "QA8b AC meal" })
      .select()
      .single();
    await client.from("meal_items").insert({
      user_id: user.id,
      meal_id: meal.id,
      name: "QA8b AC item",
      quantity: 1,
      calories_per_unit: 100,
      protein_g_per_unit: 5,
      sort_order: 0,
    });
    await page.goto("/meals");
    await expect(page.getByText("QA8b AC meal")).toBeVisible();

    // Open every surface on /meals that renders controls: the "New meal" form, an item's "Manage
    // items" -> "+ Add item" form (already expanded by default -- see MealList's expand-by-default
    // convention), and rename.
    await page.getByRole("button", { name: "+ New meal" }).click();
    await page.getByRole("button", { name: "+ Add item" }).click();
    // Bugfix (2026-08-10): "Rename" is now an icon-only button named "Rename <meal name>".
    await page.getByRole("button", { name: /^Rename/ }).click();

    const controls = await controlAttrs(page);
    const unhinted = appControls(controls).filter((c) => c.ac !== "off");
    // Fixed as part of qa-review N-2: every /meals control is now hinted. Pinned as an empty-result
    // regression guard rather than a passing-but-unverified assertion.
    expect(unhinted, JSON.stringify(unhinted)).toEqual([]);

    const forms = await page.locator("form").evaluateAll((els) =>
      els.map((e) => e.getAttribute("autocomplete")),
    );
    expect(forms.filter((f) => f !== "off")).toEqual([]);
  });

  test("label collision: getByLabel('Time', exact) still resolves to exactly ONE control with a copy expander open; the UNSCOPED substring form does NOT", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8b Label A", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("09:00") },
    ]);
    await page.goto("/food");
    await page.getByRole("button", { name: "Copy this group" }).click();
    await expect(page.getByLabel("Copy to time")).toBeVisible();

    // The design doc claims a distinct label avoids a strict-mode collision "by construction".
    // It does NOT: Playwright getByLabel is case-insensitive SUBSTRING matching by default, so the
    // unscoped form matches both controls. The developer disclosed this (DECISIONS.md
    // "Correction: Copy to time does not avoid a Playwright getByLabel collision"). Pinned here so
    // the design doc statement is demonstrably corrected rather than merely asserted.
    await expect(page.getByLabel("Time")).toHaveCount(2);
    // The workaround the corrected note prescribes:
    await expect(page.getByLabel("Time", { exact: true })).toHaveCount(1);
  });
});

// =============================================================================================
// 12. Adversarial extras: ownership through the bulk save, and a real timer defect
// =============================================================================================

test.describe("Phase8b QA: adversarial", () => {
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

  test("a foreign entry id smuggled into the bulk save is rejected wholesale, with zero rows written for EITHER user", async ({ page }) => {
    const other = await createConfirmedTestUser();
    try {
      const otherClient = await createUserClient(other);
      const foreign = await seedEntries(otherClient, other, [
        { name: "QA8b Foreign", caloriesPerUnit: 500, proteinGPerUnit: 40, consumedAt: todayAt("12:00") },
      ]);
      await seedEntries(client, user, [
        { name: "QA8b Mine A", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("08:00") },
        { name: "QA8b Mine B", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("16:00") },
      ]);

      await page.goto("/food");
      await enterSelectMode(page);
      await checkboxFor(page, "QA8b Mine A").check();
      await checkboxFor(page, "QA8b Mine B").check();
      await page.getByRole("button", { name: "Save selected as a meal" }).click();
      await page.getByLabel("Meal name").fill("QA8b Smuggled meal");

      // The dialog carries the ids as hidden inputs -- tamper one exactly as a hostile client would.
      await page.locator('input[name="entryIds"]').first().evaluate((el, id) => {
        (el as HTMLInputElement).value = id;
      }, foreign[0].id);
      await page.getByRole("button", { name: "Save meal" }).click();
      await page.waitForTimeout(1500);

      // Mixed own+foreign must fail the WHOLE request -- a partial meal would be worse than an
      // error, because it looks like it worked.
      expect(await mealsForUser(user.id)).toHaveLength(0);
      expect(await mealsForUser(other.id)).toHaveLength(0);
      // And the source rows on both sides are untouched.
      expect((await entriesForUser(other.id)).map((e) => e.name)).toEqual(["QA8b Foreign"]);
    } finally {
      await deleteTestUser(other.id);
    }
  });

  test("the success banner's timer survives unrelated parent re-renders (regression guard, fixed 2026-08-02)", async ({ page }) => {
    // Originally landed as a qa FINDING: StatusMessage's dismiss effect depended on `onDismiss`,
    // which every call site passes as a fresh inline arrow on each render, so the effect tore down
    // and re-scheduled the 6s timeout on EVERY parent render -- the banner could outlive its
    // documented window indefinitely under enough unrelated churn. Fixed in `StatusMessage.tsx` by
    // keeping the latest `onDismiss` in a ref and scheduling the timeout from an effect that depends
    // only on `autoDismissMs`. This test now asserts the FIXED behaviour: the banner still dismisses
    // on schedule despite heavy, unrelated parent re-renders during its window.
    await seedEntries(client, user, [
      { name: "QA8b Timer A", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("09:00") },
    ]);
    await page.goto("/food");
    await expect(row(page, "QA8b Timer A")).toBeVisible();

    await page.getByLabel("Name", { exact: true }).fill("QA8b Timer trigger");
    await page.getByLabel("Total calories").fill("10");
    await page.getByLabel("Total protein (g)").fill("1");
    await page.getByRole("button", { name: "Add entry" }).click();
    const banner = page.locator('[role="status"]').filter({ hasText: "Entry added." });
    await expect(banner).toBeVisible();
    const shownAt = Date.now();

    // Pure FoodDayView state churn -- the MESSAGE never changes, only the parent re-renders, on
    // every checkbox toggle -- exactly the pressure that used to restart the dismiss timer.
    await page.getByRole("button", { name: "Select entries" }).click();
    for (let i = 0; i < 12; i++) {
      await checkboxFor(page, "QA8b Timer A").click();
      await page.waitForTimeout(700);
    }

    const elapsed = Date.now() - shownAt;
    expect(elapsed).toBeGreaterThan(8500);
    // The banner is gone well past its 6s window despite the churn -- the timer was never reset.
    await expect(banner).not.toBeVisible();
  });
});

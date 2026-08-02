import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";
import { createAdminClient } from "./helpers/admin-client";
import { formatDateLabel } from "../src/lib/domain/datetime";
import type { FoodEntry, Meal } from "../src/lib/types";

/**
 * QA-REVIEWER independent Phase 8 acceptance suite -- "Ease-of-entry extras (copy/repeat)".
 *
 * Written from docs/architecture/food-weight-tracker.md 2 (copy/repeat requirements a/b/c),
 * 3.3 (the copyFoodEntries contract: time-of-day preservation, logged_from_meal_id dropped,
 * future-cap reuse, ownership), 3.4 (group-header "Copy this group", per-entry "Log again",
 * CopyDayDialog) and 8 Phase 8's own 6-scope list -- NOT from the developer's own test files.
 *
 * Everything drives the REAL Server Action through the REAL browser UI. Every "what was actually
 * written?" assertion goes through the service-role admin client, so it reflects the database, not
 * what the page happens to render.
 *
 * The browser is pinned to UTC and all fixtures are seeded on TODAY, deliberately sidestepping the
 * documented pre-existing FoodDayView Day-input navigation race. Copy TARGETS use the dialogs' own
 * "Copy to date" field (a different input, not implicated in that race) when a distinct target day
 * is needed.
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

/**
 * A fixed wall-clock instant on TODAY (UTC). Deliberately NOT "now minus N minutes": the
 * no-future-day cap is on the local DAY, not the instant, so any time-of-day today is a legal
 * fixture -- and a fixed grid keeps the distinct-times assertions deterministic even when the
 * suite happens to run just after UTC midnight (a relative helper collapses them all onto one
 * clamped instant there, which silently destroys the grouping fixtures).
 */
function todayAt(time: string): string {
  return todayUtc() + "T" + time + ":00.000Z";
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

async function seedEntries(client: SupabaseClient, user: TestUser, rows: SeedEntry[]): Promise<FoodEntry[]> {
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

/** Opens the "Copy this group" expander on the group containing `anchorText`. */
async function openCopyGroup(page: Page, anchorText: string) {
  const group = page.locator("section", { hasText: anchorText });
  await expect(group).toBeVisible();
  await group.getByRole("button", { name: "Copy this group" }).click();
  await expect(group.getByLabel("Copy to date")).toBeVisible();
  return group;
}

// =============================================================================================
// 1. (a) Copy a whole day
// =============================================================================================

test.describe("Phase8 QA: copy a whole day", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
  });
  test.afterEach(async () => { await deleteTestUser(user.id); });

  test("copies EVERY entry on the day onto the chosen past date, each keeping its own time of day", async ({ page }) => {
    const target = utcDateOffset(-2);
    const sources = await seedEntries(client, user, [
      { name: "QA8 Oats", quantity: 1, unit: "bowl", caloriesPerUnit: 320, proteinGPerUnit: 11, consumedAt: todayAt("07:30") },
      { name: "QA8 Burrito", quantity: 2, caloriesPerUnit: 410.5, proteinGPerUnit: 21.25, consumedAt: todayAt("13:00") },
      { name: "QA8 Almonds", quantity: 30, unit: "g", caloriesPerUnit: 5.79, proteinGPerUnit: 0.21, consumedAt: todayAt("20:00") },
    ]);

    await page.goto("/food");
    await expect(page.getByText("QA8 Oats")).toBeVisible();

    await page.getByRole("button", { name: "Copy this day" }).click();
    await page.getByLabel("Copy to date").fill(target);
    await page.getByRole("button", { name: "Copy day" }).click();
    await expect(page.getByText("Copied 3 entries to " + formatDateLabel(target))).toBeVisible();

    const copies = (await entriesForUser(user.id)).filter((r) => r.consumed_local_date === target);
    expect(copies).toHaveLength(3);

    // Each source's own local time-of-day is reproduced -- NOT collapsed onto one shared instant
    // (which would wrongly merge the whole day into a single meal group).
    const byName = new Map(copies.map((c) => [c.name, c]));
    for (const source of sources) {
      const copy = byName.get(source.name);
      expect(copy, "missing copy of " + source.name).toBeTruthy();
      expect(copy!.consumed_at.slice(11, 16)).toBe(source.consumed_at.slice(11, 16));
      expect(copy!.id).not.toBe(source.id);
      expect(copy!.user_id).toBe(user.id);
      expect(copy!.quantity).toBe(source.quantity);
      expect(copy!.unit).toBe(source.unit);
      expect(copy!.calories_per_unit).toBe(source.calories_per_unit);
      expect(copy!.protein_g_per_unit).toBe(source.protein_g_per_unit);
      // Totals are GENERATED, never copied -- so equal per-unit inputs must yield equal totals.
      expect(copy!.calories).toBe(source.calories);
      expect(copy!.protein_g).toBe(source.protein_g);
      expect(copy!.logged_from_meal_id).toBeNull();
    }
    expect(new Set(copies.map((c) => c.consumed_at)).size).toBe(3);
  });

  test("leaves the source day byte-identical -- a copy is purely additive", async ({ page }) => {
    const target = utcDateOffset(-4);
    await seedEntries(client, user, [
      { name: "QA8 Src A", caloriesPerUnit: 250, proteinGPerUnit: 12, consumedAt: todayAt("08:00") },
      { name: "QA8 Src B", caloriesPerUnit: 150, proteinGPerUnit: 3, consumedAt: todayAt("16:00") },
    ]);
    const before = (await entriesForUser(user.id)).filter((r) => r.consumed_local_date === todayUtc());

    await page.goto("/food");
    await page.getByRole("button", { name: "Copy this day" }).click();
    await page.getByLabel("Copy to date").fill(target);
    await page.getByRole("button", { name: "Copy day" }).click();
    await expect(page.getByText("Copied 2 entries to " + formatDateLabel(target))).toBeVisible();

    const after = (await entriesForUser(user.id)).filter((r) => r.consumed_local_date === todayUtc());
    // Whole-row deep equality catches ANY field a per-field assertion would miss, including
    // updated_at (which the schema trigger bumps on any stray UPDATE).
    expect(after).toEqual(before);
  });

  test("copying onto the SAME day duplicates the entries in place rather than replacing them", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8 Dupe", caloriesPerUnit: 111, proteinGPerUnit: 4, consumedAt: todayAt("18:00") },
    ]);

    await page.goto("/food");
    await page.getByRole("button", { name: "Copy this day" }).click();
    // The target date field defaults to today, so submit as-is.
    await expect(page.getByLabel("Copy to date")).toHaveValue(todayUtc());
    await page.getByRole("button", { name: "Copy day" }).click();

    await expect(page.getByText("QA8 Dupe")).toHaveCount(2);
    const rows = (await entriesForUser(user.id)).filter((r) => r.name === "QA8 Dupe");
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  test("the Copy this day control is not offered on a day with nothing to copy", async ({ page }) => {
    await page.goto("/food");
    await expect(page.getByText("No entries logged for this day yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy this day" })).toHaveCount(0);
  });

  test("drops logged_from_meal_id even when copying entries that came from a saved meal", async ({ page }) => {
    const target = utcDateOffset(-6);
    const { data: meal } = await client.from("meals").insert({ user_id: user.id, name: "QA8 Meal" }).select().single();
    const mealId = (meal as Meal).id;
    const at = todayAt("14:00");
    const sources = await seedEntries(client, user, [
      { name: "QA8 Egg", quantity: 2, unit: "egg", caloriesPerUnit: 72, proteinGPerUnit: 6.3, consumedAt: at, loggedFromMealId: mealId },
      { name: "QA8 Toast", quantity: 1, unit: "slice", caloriesPerUnit: 90, proteinGPerUnit: 3.1, consumedAt: at, loggedFromMealId: mealId },
    ]);
    // Sanity: the fixture really does carry the back-reference, so the negative cannot pass vacuously.
    expect(sources.every((s) => s.logged_from_meal_id === mealId)).toBe(true);

    await page.goto("/food");
    await expect(page.getByText("From a saved meal")).toHaveCount(2);

    await page.getByRole("button", { name: "Copy this day" }).click();
    await page.getByLabel("Copy to date").fill(target);
    await page.getByRole("button", { name: "Copy day" }).click();
    await expect(page.getByText("Copied 2 entries to " + formatDateLabel(target))).toBeVisible();

    const copies = (await entriesForUser(user.id)).filter((r) => r.consumed_local_date === target);
    expect(copies).toHaveLength(2);
    for (const copy of copies) expect(copy.logged_from_meal_id).toBeNull();
    // ...and the sources keep theirs.
    const stillSourced = (await entriesForUser(user.id)).filter((r) => r.consumed_local_date === todayUtc());
    for (const src of stillSourced) expect(src.logged_from_meal_id).toBe(mealId);
  });
});

// =============================================================================================
// 2. (c) Copy a meal group -- exact subset, and it stays grouped
// =============================================================================================

test.describe("Phase8 QA: copy a meal group", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
  });
  test.afterEach(async () => { await deleteTestUser(user.id); });

  test("copies EXACTLY that group -- not the whole day, not another group -- and the copies stay one group", async ({ page }) => {
    const target = utcDateOffset(-2);
    const lunch = todayAt("12:45");
    await seedEntries(client, user, [
      { name: "QA8 Grp Eggs", quantity: 3, unit: "egg", caloriesPerUnit: 72, proteinGPerUnit: 6.3, consumedAt: lunch },
      { name: "QA8 Grp Toast", quantity: 2, unit: "slice", caloriesPerUnit: 90, proteinGPerUnit: 3.1, consumedAt: lunch },
      { name: "QA8 Grp Juice", caloriesPerUnit: 110, proteinGPerUnit: 1.7, consumedAt: lunch },
      // A separate group on the same day -- must NOT be copied.
      { name: "QA8 Other Snack", caloriesPerUnit: 200, proteinGPerUnit: 5, consumedAt: todayAt("22:00") },
    ]);

    await page.goto("/food");
    const group = await openCopyGroup(page, "QA8 Grp Eggs");

    // The read-only preview lists exactly the group, not the day.
    await expect(group.getByText("3 items to copy")).toBeVisible();
    await expect(group.getByText("QA8 Other Snack")).toHaveCount(0);

    await group.getByLabel("Copy to date").fill(target);
    await group.getByRole("button", { name: "Copy group" }).click();
    await expect(page.getByText("Copied 3 entries to " + formatDateLabel(target))).toBeVisible();

    const copies = (await entriesForUser(user.id)).filter((r) => r.consumed_local_date === target);
    expect(copies.map((c) => c.name).sort()).toEqual(["QA8 Grp Eggs", "QA8 Grp Juice", "QA8 Grp Toast"]);
    // The load-bearing property: one shared new instant, so they remain one meal group.
    expect(new Set(copies.map((c) => c.consumed_at)).size).toBe(1);
    expect(copies[0].consumed_at.slice(11, 16)).toBe(lunch.slice(11, 16));
    for (const c of copies) expect(c.logged_from_meal_id).toBeNull();
  });

  test("a group copied onto the day being viewed renders as ONE new group header, not three loose entries", async ({ page }) => {
    const at = todayAt("09:30");
    await seedEntries(client, user, [
      { name: "QA8 Same Eggs", caloriesPerUnit: 72, proteinGPerUnit: 6.3, consumedAt: at },
      { name: "QA8 Same Toast", caloriesPerUnit: 90, proteinGPerUnit: 3.1, consumedAt: at },
    ]);

    await page.goto("/food");
    await expect(page.locator("section")).toHaveCount(1);

    const group = await openCopyGroup(page, "QA8 Same Eggs");
    await expect(group.getByLabel("Copy to date")).toHaveValue(todayUtc());
    await group.getByRole("button", { name: "Copy group" }).click();

    await expect(page.getByText("Copied 2 entries to " + formatDateLabel(todayUtc()))).toBeVisible();
    // Same time-of-day on the same day == the SAME instant, so the copies merge into the existing
    // group rather than forming a second one. Either way the invariant under test is "the copies
    // are one group": assert the copies all share one consumed_at at the DB level.
    const rows = await entriesForUser(user.id);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.consumed_at)).size).toBe(1);
    await expect(page.locator("section")).toHaveCount(1);
  });

  test("only one group expander can be open at a time (Save as meal and Copy this group are mutually exclusive)", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8 Excl", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("17:30") },
    ]);
    await page.goto("/food");
    const group = page.locator("section", { hasText: "QA8 Excl" });

    await group.getByRole("button", { name: "Save as meal" }).click();
    await expect(group.getByLabel("Meal name")).toBeVisible();

    await group.getByRole("button", { name: "Copy this group" }).click();
    await expect(group.getByLabel("Copy to date")).toBeVisible();
    await expect(group.getByLabel("Meal name")).toHaveCount(0);
  });

  test("FINDING (N): with a copy expander open, two different buttons in the same group both read Cancel", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8 Ambig", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("17:30") },
    ]);
    await page.goto("/food");
    const group = await openCopyGroup(page, "QA8 Ambig");
    // Documents the recurrence of Phase 7b's deferred N-3 on the new "Copy this group" control:
    // the header toggle flips to "Cancel" while the dialog already has its own "Cancel".
    await expect(group.getByRole("button", { name: "Cancel" })).toHaveCount(2);
  });
});

// =============================================================================================
// 3. (b) "Log again"
// =============================================================================================

test.describe("Phase8 QA: Log again", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
  });
  test.afterEach(async () => { await deleteTestUser(user.id); });

  test("one tap re-logs that exact entry to today, on the quarter-hour grid, leaving the source untouched", async ({ page }) => {
    const [source] = await seedEntries(client, user, [
      { name: "QA8 Shake", quantity: 1.5, unit: "scoop", caloriesPerUnit: 120.5, proteinGPerUnit: 24.25, consumedAt: todayAt("06:15") },
    ]);
    const before = await entriesForUser(user.id);

    await page.goto("/food");
    await page.getByRole("button", { name: "Log again" }).click();
    await expect(page.getByText('Logged "QA8 Shake" again.')).toBeVisible();

    const rows = await entriesForUser(user.id);
    expect(rows).toHaveLength(2);
    const copy = rows.find((r) => r.id !== source.id)!;

    expect(copy.name).toBe(source.name);
    expect(copy.quantity).toBe(source.quantity);
    expect(copy.unit).toBe(source.unit);
    expect(copy.calories_per_unit).toBe(source.calories_per_unit);
    expect(copy.protein_g_per_unit).toBe(source.protein_g_per_unit);
    expect(copy.calories).toBe(source.calories);
    expect(copy.protein_g).toBe(source.protein_g);
    expect(copy.logged_from_meal_id).toBeNull();
    expect(copy.user_id).toBe(user.id);

    // Lands on today, on the 15-minute grid, at or before "now" (a floor, never a future bucket).
    expect(copy.consumed_local_date).toBe(todayUtc());
    const minutes = Number(copy.consumed_at.slice(14, 16));
    expect(minutes % 15).toBe(0);
    expect(new Date(copy.consumed_at).getTime()).toBeLessThanOrEqual(Date.now());

    // The source row is byte-identical.
    const sourceAfter = rows.find((r) => r.id === source.id)!;
    expect(sourceAfter).toEqual(before.find((r) => r.id === source.id));
  });

  test("Log again on a meal-logged entry produces a plain entry with no From a saved meal badge", async ({ page }) => {
    const { data: meal } = await client.from("meals").insert({ user_id: user.id, name: "QA8 LA Meal" }).select().single();
    const mealId = (meal as Meal).id;
    await seedEntries(client, user, [
      { name: "QA8 LA Egg", caloriesPerUnit: 72, proteinGPerUnit: 6.3, consumedAt: todayAt("06:15"), loggedFromMealId: mealId },
    ]);

    await page.goto("/food");
    await expect(page.getByText("From a saved meal")).toHaveCount(1);

    await page.getByRole("button", { name: "Log again" }).first().click();
    await expect(page.getByText('Logged "QA8 LA Egg" again.')).toBeVisible();
    // Scoped to entry ROWS specifically (not a page-wide text search): Phase 8b's success-message
    // restyle also names the entry in its confirmation ("Logged "QA8 LA Egg" again."), which is a
    // page-wide getByText("QA8 LA Egg") would ALSO match -- previously masked only by a timing
    // coincidence (the old 4s auto-dismiss happened to elapse within this assertion's 5s retry
    // window; the design's now-longer 6s SUCCESS_MESSAGE_MS duration no longer does).
    await expect(page.locator("li", { hasText: "QA8 LA Egg" })).toHaveCount(2);
    // Still exactly one badge: the copy did NOT inherit the back-reference.
    await expect(page.getByText("From a saved meal")).toHaveCount(1);

    const rows = await entriesForUser(user.id);
    expect(rows.filter((r) => r.logged_from_meal_id === mealId)).toHaveLength(1);
    expect(rows.filter((r) => r.logged_from_meal_id === null)).toHaveLength(1);
  });

  test("Log again on one entry in a group copies only that entry", async ({ page }) => {
    const at = todayAt("06:45");
    await seedEntries(client, user, [
      { name: "QA8 One", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: at },
      { name: "QA8 Two", caloriesPerUnit: 200, proteinGPerUnit: 9, consumedAt: at },
    ]);

    await page.goto("/food");
    const row = page.locator("li", { hasText: "QA8 One" });
    await row.getByRole("button", { name: "Log again" }).click();
    await expect(page.getByText('Logged "QA8 One" again.')).toBeVisible();

    const rows = await entriesForUser(user.id);
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.name === "QA8 One")).toHaveLength(2);
    expect(rows.filter((r) => r.name === "QA8 Two")).toHaveLength(1);
  });
});

// =============================================================================================
// 4. The no-future-day cap cannot be bypassed from any entry point
// =============================================================================================

test.describe("Phase8 QA: no-future-day cap on copies", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
  });
  test.afterEach(async () => { await deleteTestUser(user.id); });

  /** Strips the max attribute so a future date can actually be submitted, as a hostile client would. */
  async function forceFutureDate(page: Page, inputId: string, value: string) {
    await page.evaluate(
      ({ inputId, value }: { inputId: string; value: string }) => {
        const el = document.getElementById(inputId) as HTMLInputElement | null;
        if (!el) throw new Error("date input not found: " + inputId);
        el.removeAttribute("max");
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
        setter.call(el, value);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      },
      { inputId, value },
    );
  }

  test("the date field is capped at today by the browser (max attribute) on both copy dialogs", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8 Cap", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("17:30") },
    ]);
    await page.goto("/food");

    await page.getByRole("button", { name: "Copy this day" }).click();
    await expect(page.getByLabel("Copy to date")).toHaveAttribute("max", todayUtc());
    await page.getByRole("button", { name: "Close" }).click();

    const group = await openCopyGroup(page, "QA8 Cap");
    await expect(group.getByLabel("Copy to date")).toHaveAttribute("max", todayUtc());
  });

  test("Copy this day: a tomorrow target forced past the client max is rejected SERVER-SIDE with zero rows written", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8 FutureDay", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("17:30") },
    ]);
    await page.goto("/food");

    await page.getByRole("button", { name: "Copy this day" }).click();
    await forceFutureDate(page, "copy-day-target-date", utcDateOffset(1));
    await expect(page.getByLabel("Copy to date")).toHaveValue(utcDateOffset(1));
    await page.getByRole("button", { name: "Copy day" }).click();

    await expect(page.getByText("You can't copy to a date later than today. Pick today or an earlier date.")).toBeVisible();
    // The evidentiary bar: nothing was written ANYWHERE, checked with the service-role client.
    expect(await entriesForUser(user.id)).toHaveLength(1);
  });

  test("Copy this group: a tomorrow target forced past the client max is rejected SERVER-SIDE with zero rows written", async ({ page }) => {
    const at = todayAt("16:00");
    await seedEntries(client, user, [
      { name: "QA8 FutureGrpA", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: at },
      { name: "QA8 FutureGrpB", caloriesPerUnit: 200, proteinGPerUnit: 9, consumedAt: at },
    ]);
    await page.goto("/food");

    const group = await openCopyGroup(page, "QA8 FutureGrpA");
    await forceFutureDate(page, "copy-group-target-date", utcDateOffset(1));
    await group.getByRole("button", { name: "Copy group" }).click();

    await expect(page.getByText("You can't copy to a date later than today. Pick today or an earlier date.")).toBeVisible();
    expect(await entriesForUser(user.id)).toHaveLength(2);
  });
});

// =============================================================================================
// 5. Isolation, regression guards, and confirmed non-goals
// =============================================================================================

test.describe("Phase8 QA: isolation, regression guards, non-goals", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
  });
  test.afterEach(async () => { await deleteTestUser(user.id); });

  test("another user never sees, and can never copy, this user entries", async ({ page, browser }) => {
    await seedEntries(client, user, [
      { name: "QA8 PrivateLunch", caloriesPerUnit: 500, proteinGPerUnit: 25, consumedAt: todayAt("17:30") },
    ]);
    await page.goto("/food");
    await expect(page.getByText("QA8 PrivateLunch")).toBeVisible();

    const other = await createConfirmedTestUser();
    try {
      const ctx = await browser.newContext({ timezoneId: "UTC" });
      const otherPage = await ctx.newPage();
      await logIn(otherPage, other);
      await otherPage.goto("/food");
      await expect(otherPage.getByText("No entries logged for this day yet.")).toBeVisible();
      await expect(otherPage.getByText("QA8 PrivateLunch")).toHaveCount(0);
      await expect(otherPage.getByRole("button", { name: "Copy this day" })).toHaveCount(0);
      await expect(otherPage.getByRole("button", { name: "Log again" })).toHaveCount(0);
      expect(await entriesForUser(other.id)).toHaveLength(0);
      await ctx.close();
    } finally {
      await deleteTestUser(other.id);
    }
    expect(await entriesForUser(user.id)).toHaveLength(1);
  });

  test("opening a copy dialog does not submit the food-entry form (no nested-form regression)", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8 NoNest", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("17:30") },
    ]);
    await page.goto("/food");

    await page.getByRole("button", { name: "Copy this day" }).click();
    await expect(page.getByLabel("Copy to date")).toBeVisible();
    const group = await openCopyGroup(page, "QA8 NoNest");
    await group.getByRole("button", { name: "Cancel" }).last().click();

    expect(await entriesForUser(user.id)).toHaveLength(1);
    await expect(page.getByText("Please fix the highlighted errors.")).toHaveCount(0);
  });

  test("an open copy-group expander survives a background refresh caused by an unrelated add", async ({ page }) => {
    const target = utcDateOffset(-3);
    await seedEntries(client, user, [
      { name: "QA8 Survive", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("07:30") },
    ]);
    await page.goto("/food");

    const group = await openCopyGroup(page, "QA8 Survive");
    await group.getByLabel("Copy to date").fill(target);

    await page.getByLabel("Name").fill("QA8 Unrelated");
    await page.getByLabel("Total calories").fill("50");
    await page.getByLabel("Total protein (g)").fill("2");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("QA8 Unrelated")).toBeVisible();

    await expect(group.getByLabel("Copy to date")).toBeVisible();
    await expect(group.getByLabel("Copy to date")).toHaveValue(target);
  });

  // Phase 8b (2026-08-01) built multi-select -- this test previously asserted it did NOT exist
  // (qa-review N-1 on Phase 8). Updated in the same change that shipped the feature, per the
  // design doc's explicit "update this test in the same change" requirement, rather than leaving a
  // stale acceptance assertion pinning behaviour that's now deliberately different. A thorough,
  // independent acceptance suite for Phase 8b's multi-select itself is qa-reviewer's job (per this
  // project's role split) -- this is just a smoke check that select mode is real and reachable.
  test("multi-select (Phase 8b) is built: select mode reveals per-row checkboxes and enables bulk actions", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8 Multi A", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("17:30") },
      { name: "QA8 Multi B", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("21:00") },
    ]);
    await page.goto("/food");

    // Not in select mode yet: no checkboxes, no selection bar.
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy selected" })).toHaveCount(0);

    await page.getByRole("button", { name: "Select entries" }).click();
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(2);
    await expect(page.getByText("0 selected")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy selected" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Save selected as a meal" })).toBeDisabled();

    await page.getByRole("checkbox", { name: /QA8 Multi A/ }).check();
    await expect(page.getByText("1 selected")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy selected" })).toBeEnabled();

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.locator('input[type="checkbox"]')).toHaveCount(0);
  });

  test("no copy/quick-add control was added to the dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Copy/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Log again/i })).toHaveCount(0);
  });
});

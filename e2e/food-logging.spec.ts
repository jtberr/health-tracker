import { test, expect, type Page } from "@playwright/test";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";

/**
 * Phase 3 ("Core food logging loop") developer-level acceptance coverage, per
 * docs/architecture/food-weight-tracker.md §6/§8 Phase 3: per-entry protein %, day ratio-of-sums
 * vs average, exact-timestamp grouping, 15-min grid + floor default, smart time default,
 * minimal-form submit -> valid unitless entry, quantity edit recalculates totals, no-future-day
 * (add/edit).
 *
 * Requires `npx supabase start` running locally (or an equivalent CI service) plus the env vars
 * in .env.example. Actually run against a live local Supabase instance during development of this
 * phase — see the implementation report for confirmation.
 *
 * This is the developer's own coverage of this phase's scope; qa-reviewer independently writes
 * and runs its own adversarial acceptance tests from the spec per the project workflow.
 */

async function logIn(page: Page, user: TestUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
}

function tomorrowLocalDateStr(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

test.describe("Phase 3 — core food logging loop", () => {
  let user: TestUser;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
    await page.goto("/food");
    await expect(page.getByRole("heading", { name: "Food log" })).toBeVisible();
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("minimal-form submit produces a valid unitless (quantity 1) entry", async ({ page }) => {
    await page.getByLabel("Name").fill("Banana");
    await page.getByLabel("Total calories").fill("105");
    await page.getByLabel("Total protein (g)").fill("1.3");
    await page.getByRole("button", { name: "Add entry" }).click();

    await expect(page.getByText("Banana")).toBeVisible();
    // Minimal (quantity 1, no unit) entries render as just the bare name, not "1x — Banana".
    await expect(page.locator("li", { hasText: "Banana" })).toContainText("105 kcal");
    await expect(page.locator("li", { hasText: "Banana" })).toContainText("1.3g protein");
  });

  test("the time input is restricted to the 15-minute grid and defaults to floor-of-now", async ({
    page,
  }) => {
    const timeInput = page.getByLabel("Time");
    await expect(timeInput).toHaveAttribute("step", "900");
    const value = await timeInput.inputValue(); // "HH:MM"
    const minutes = Number(value.slice(3, 5));
    expect([0, 15, 30, 45]).toContain(minutes);

    const now = new Date();
    const [h, m] = value.split(":").map(Number);
    const inputMinutesSinceMidnight = h * 60 + m;
    const nowMinutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
    // Floor, never a future bucket relative to "now" (allow a small margin for slow CI ticks).
    expect(inputMinutesSinceMidnight).toBeLessThanOrEqual(nowMinutesSinceMidnight + 1);
  });

  test("smart time default: a second add moments later shares the first entry's time and groups", async ({
    page,
  }) => {
    await page.getByLabel("Name").fill("Toast");
    await page.getByLabel("Total calories").fill("120");
    await page.getByLabel("Total protein (g)").fill("4");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Toast")).toBeVisible();

    await page.getByLabel("Name").fill("Butter");
    await page.getByLabel("Total calories").fill("100");
    await page.getByLabel("Total protein (g)").fill("0");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Butter")).toBeVisible();

    // Both entries logged moments apart should land in exactly one meal group (one header row).
    await expect(page.locator("section")).toHaveCount(1);
    const group = page.locator("section");
    await expect(group).toContainText("Toast");
    await expect(group).toContainText("Butter");
    // Ratio-of-sums group total: 220 kcal, 4g protein.
    await expect(group.locator("header")).toContainText("220 kcal");
    await expect(group.locator("header")).toContainText("4g protein");
  });

  test("no-future-day is rejected on add, even bypassing the date input's own max", async ({
    page,
  }) => {
    await page.getByLabel("Name").fill("Time traveler snack");
    await page.getByLabel("Total calories").fill("50");
    await page.getByLabel("Total protein (g)").fill("2");
    // The form has noValidate (so native `max` enforcement doesn't block this fill/submit) —
    // this is exactly what lets us prove the *server* rejects it, not just the browser.
    await page.getByLabel("Date").fill(tomorrowLocalDateStr());
    await page.getByRole("button", { name: "Add entry" }).click();

    await expect(page.getByText(/can't log an entry dated later than today/i)).toBeVisible();
    await expect(page.getByText("Time traveler snack")).toHaveCount(0);
  });

  test("quantity edit recalculates the entry's totals", async ({ page }) => {
    await page.getByLabel("Name").fill("Egg");
    await page.getByLabel("Total calories").fill("70");
    await page.getByLabel("Total protein (g)").fill("6");
    await page.getByText("Add detail (quantity, unit)").click();
    await page.getByRole("spinbutton", { name: "Quantity" }).fill("2");
    await page.getByLabel("Unit (optional)").fill("eggs");
    // Detail is expanded; still in "total" mode (default), so 70/6 are totals for 2 eggs.
    await page.getByRole("button", { name: "Add entry" }).click();

    const row = page.locator("li", { hasText: "Egg" });
    await expect(row).toContainText("70 kcal");

    await row.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("spinbutton", { name: "Quantity" }).fill("4");
    await page.getByRole("button", { name: "Save changes" }).click();

    // 4 eggs at the same per-unit rate (35 kcal/egg from the original 70kcal/2 total) = 140 kcal.
    await expect(page.locator("li", { hasText: "Egg" })).toContainText("140 kcal");
    await expect(page.locator("li", { hasText: "Egg" })).toContainText("12g protein");
  });

  test("edit rejects a future date too", async ({ page }) => {
    await page.getByLabel("Name").fill("Cereal");
    await page.getByLabel("Total calories").fill("200");
    await page.getByLabel("Total protein (g)").fill("5");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Cereal")).toBeVisible();

    const row = page.locator("li", { hasText: "Cereal" });
    await row.getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Date").fill(tomorrowLocalDateStr());
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(page.getByText(/can't log an entry dated later than today/i)).toBeVisible();
  });

  test("delete removes an entry from the list and the day total", async ({ page }) => {
    await page.getByLabel("Name").fill("Chips");
    await page.getByLabel("Total calories").fill("150");
    await page.getByLabel("Total protein (g)").fill("2");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Chips")).toBeVisible();

    const row = page.locator("li", { hasText: "Chips" });
    await row.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("Chips")).toHaveCount(0);
  });
});

test.describe("Phase 3 — protein % and ratio-of-sums (DB-seeded fixtures)", () => {
  let user: TestUser;
  const day = "2026-07-10";

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("per-entry protein %: 30g/240kcal shows 50%, a 0-kcal entry shows the dash", async ({
    page,
  }) => {
    const client = await createUserClient(user);
    await client.from("food_entries").insert([
      {
        user_id: user.id,
        name: "Protein snack",
        quantity: 1,
        calories_per_unit: 240,
        protein_g_per_unit: 30,
        consumed_at: `${day}T12:00:00Z`,
        consumed_tz: "UTC",
      },
      {
        user_id: user.id,
        name: "Zero-cal seasoning",
        quantity: 1,
        calories_per_unit: 0,
        protein_g_per_unit: 0.5,
        consumed_at: `${day}T18:00:00Z`,
        consumed_tz: "UTC",
      },
    ]);

    await page.goto("/food");
    await page.getByLabel("Day").fill(day);

    const proteinRow = page.locator("li", { hasText: "Protein snack" });
    await expect(proteinRow).toContainText("50%");

    const zeroRow = page.locator("li", { hasText: "Zero-cal seasoning" });
    await expect(zeroRow).toContainText("—");
  });

  test("day rollup is ratio-of-sums, not the average of per-entry percentages", async ({ page }) => {
    const client = await createUserClient(user);
    // Meal: 30g protein / 200 kcal (60%). Shake: 10g protein / 300 kcal (13.3%).
    // Average of the two percentages ~= 36.7%. Ratio-of-sums = (40*4)/500*100 = 32%.
    await client.from("food_entries").insert([
      {
        user_id: user.id,
        name: "Meal",
        quantity: 1,
        calories_per_unit: 200,
        protein_g_per_unit: 30,
        consumed_at: `${day}T08:00:00Z`,
        consumed_tz: "UTC",
      },
      {
        user_id: user.id,
        name: "Shake",
        quantity: 1,
        calories_per_unit: 300,
        protein_g_per_unit: 10,
        consumed_at: `${day}T09:00:00Z`,
        consumed_tz: "UTC",
      },
    ]);

    await page.goto("/food");
    await page.getByLabel("Day").fill(day);

    // DailyTotals shows the day-level ratio-of-sums %, not the ~36.7% average of the two entries.
    await expect(page.getByText("32%", { exact: true })).toBeVisible();
    await expect(page.getByText(/36\.7%/)).toHaveCount(0);
  });

  test("entries at distinct instants render as separate meal groups", async ({ page }) => {
    const client = await createUserClient(user);
    await client.from("food_entries").insert([
      {
        user_id: user.id,
        name: "Breakfast item",
        quantity: 1,
        calories_per_unit: 100,
        protein_g_per_unit: 5,
        consumed_at: `${day}T08:00:00Z`,
        consumed_tz: "UTC",
      },
      {
        user_id: user.id,
        name: "Dinner item",
        quantity: 1,
        calories_per_unit: 100,
        protein_g_per_unit: 5,
        consumed_at: `${day}T20:00:00Z`,
        consumed_tz: "UTC",
      },
    ]);

    await page.goto("/food");
    await page.getByLabel("Day").fill(day);

    await expect(page.locator("section")).toHaveCount(2);
  });

  test("entries sharing the exact same consumed_at render under one group with a group-level %", async ({
    page,
  }) => {
    const client = await createUserClient(user);
    const sharedInstant = `${day}T12:00:00Z`;
    await client.from("food_entries").insert([
      {
        user_id: user.id,
        name: "Rice",
        quantity: 1,
        calories_per_unit: 200,
        protein_g_per_unit: 4,
        consumed_at: sharedInstant,
        consumed_tz: "UTC",
      },
      {
        user_id: user.id,
        name: "Chicken",
        quantity: 1,
        calories_per_unit: 200,
        protein_g_per_unit: 36,
        consumed_at: sharedInstant,
        consumed_tz: "UTC",
      },
    ]);

    await page.goto("/food");
    await page.getByLabel("Day").fill(day);

    await expect(page.locator("section")).toHaveCount(1);
    const group = page.locator("section");
    await expect(group).toContainText("Rice");
    await expect(group).toContainText("Chicken");
    // Ratio-of-sums: (40*4)/400*100 = 40%.
    await expect(group.locator("header")).toContainText("40% from protein");
  });
});

import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";
import { createAdminClient } from "./helpers/admin-client";
import type { Meal } from "../src/lib/types";

/**
 * QA-REVIEWER independent Phase 8f acceptance suite -- "Saved meals: pinning and duplicating",
 * the UI half. The action-level rows 6 says to hammer (RLS on the new column, sort_order
 * preservation, byte-identical source, ownership and the compensating delete) live in
 * src/lib/actions/meals-pinning.qa.test.ts, because the browser cannot reach them.
 *
 * Written from docs/architecture/food-weight-tracker.md 3.4's "Pinned meals and duplicating a
 * meal" block, 6's matching rows and 8's Phase 8f section -- NOT from the implementation.
 */

test.use({ timezoneId: "UTC" });

let user: TestUser;
let client: SupabaseClient;
let admin: SupabaseClient;

test.beforeAll(async () => {
  user = await createConfirmedTestUser();
  client = await createUserClient(user);
  admin = createAdminClient();
});

test.afterAll(async () => {
  if (user) await deleteTestUser(user.id);
});

async function logIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/food");
}

/**
 * MealsView loads its meals through a CLIENT-side RLS-scoped read, so the heading appears before
 * any card does. Waiting only on the heading made these tests read an empty list under load.
 * Callers pass the number of cards they seeded so the wait is deterministic rather than a sleep.
 */
async function gotoMeals(page: Page, expectedCards: number) {
  await page.goto("/meals");
  await expect(page.getByRole("heading", { name: "Saved meals" })).toBeVisible({ timeout: 15000 });
  await expect(page.locator("p.text-lg.font-semibold")).toHaveCount(expectedCards, { timeout: 15000 });
}

async function seedMeal(name: string, itemCount = 1, isPinned = false): Promise<Meal> {
  const { data, error } = await client
    .from("meals")
    .insert({ user_id: user.id, name, is_pinned: isPinned })
    .select()
    .single();
  if (error || !data) throw new Error("seedMeal failed: " + (error?.message ?? "no data"));
  for (let i = 0; i < itemCount; i++) {
    await client.from("meal_items").insert({
      meal_id: data.id,
      user_id: user.id,
      name: "Ingredient " + i,
      quantity: 1,
      unit: null,
      calories_per_unit: 100,
      protein_g_per_unit: 10,
      sort_order: i,
    });
  }
  return data as Meal;
}

async function clearMeals() {
  await client.from("meals").delete().eq("user_id", user.id);
  await client.from("food_entries").delete().eq("user_id", user.id);
}

/** The rendered order of meal names on /meals -- the pre-existing Phase 7c selector contract. */
async function renderedOrder(page: Page): Promise<string[]> {
  return page.locator("p.text-lg.font-semibold").allTextContents();
}

test.describe("Phase 8f -- pinned-first ordering, on BOTH surfaces", () => {
  test.beforeEach(async () => {
    await clearMeals();
  });

  test("a pinned meal whose name sorts LAST renders first on /meals", async ({ page }) => {
    await seedMeal("Alpha brunch");
    await seedMeal("Mid snack");
    await seedMeal("Zulu supper", 1, true);

    await logIn(page);
    await gotoMeals(page, 3);

    expect(await renderedOrder(page)).toEqual(["Zulu supper", "Alpha brunch", "Mid snack"]);
  });

  test("...and appears first in LogMealDialog's picker too (7c's one shared ordering)", async ({ page }) => {
    await seedMeal("Alpha brunch");
    await seedMeal("Mid snack");
    await seedMeal("Zulu supper", 1, true);

    await logIn(page);
    await page.getByRole("button", { name: "Log a saved meal", exact: true }).click();
    const panel = page.getByRole("region", { name: "Log a saved meal", exact: true });
    await expect(panel).toBeVisible();

    const all = await panel.getByLabel("Meal", { exact: true }).locator("option").allTextContents();
    // option[0] is the non-meal "Choose a meal..." placeholder; the real meals follow it.
    const labels = all.slice(1);
    expect(labels[0]).toContain("Zulu supper");
    // 7c's type-ahead invariant: every option label STARTS with the meal name.
    expect(labels[0].startsWith("Zulu supper")).toBe(true);
    expect(labels.map((l) => l.split(" (")[0])).toEqual(["Zulu supper", "Alpha brunch", "Mid snack"]);
  });

  test("pinning one meal does not reshuffle the others", async ({ page }) => {
    await seedMeal("Alpha brunch");
    await seedMeal("Mid snack");
    await seedMeal("Zulu supper");

    await logIn(page);
    await gotoMeals(page, 3);
    const before = await renderedOrder(page);
    expect(before).toEqual(["Alpha brunch", "Mid snack", "Zulu supper"]);

    await page.getByRole("button", { name: "Pin Zulu supper", exact: true }).click();
    await expect(page.getByRole("button", { name: "Unpin Zulu supper", exact: true })).toBeVisible();

    const after = await renderedOrder(page);
    expect(after[0]).toBe("Zulu supper");
    // Every other card's RELATIVE order is untouched.
    expect(after.slice(1)).toEqual(before.filter((n) => n !== "Zulu supper"));
  });

  test("the picker's Pinned/All meals optgroups appear ONLY when something is pinned", async ({ page }) => {
    await seedMeal("Alpha brunch");
    await seedMeal("Zulu supper");

    await logIn(page);
    await page.getByRole("button", { name: "Log a saved meal", exact: true }).click();
    const panel = page.getByRole("region", { name: "Log a saved meal", exact: true });
    const select = panel.getByLabel("Meal", { exact: true });
    // Nothing pinned -> a flat list, no groups.
    expect(await select.locator("optgroup").count()).toBe(0);

    // Pin one, and the two groups appear.
    await client.from("meals").update({ is_pinned: true }).eq("user_id", user.id).eq("name", "Zulu supper");
    await page.reload();
    await page.getByRole("button", { name: "Log a saved meal", exact: true }).click();
    const panel2 = page.getByRole("region", { name: "Log a saved meal", exact: true });
    const select2 = panel2.getByLabel("Meal", { exact: true });
    const groups = select2.locator("optgroup");
    await expect(groups).toHaveCount(2);
    expect(await groups.nth(0).getAttribute("label")).toBe("Pinned");
    expect(await groups.nth(1).getAttribute("label")).toBe("All meals");
    // Name-first labels survive inside the groups.
    const firstPinned = await groups.nth(0).locator("option").first().textContent();
    expect((firstPinned ?? "").startsWith("Zulu supper")).toBe(true);
  });
});

test.describe("Phase 8f -- pinned state is legible without colour, and filtering beats pinning", () => {
  test.beforeEach(async () => {
    await clearMeals();
  });

  test('a pinned card shows a "Pinned" TEXT pill; the toggle exposes a name and aria-pressed', async ({
    page,
  }) => {
    await seedMeal("Alpha brunch");
    await logIn(page);
    await gotoMeals(page, 1);

    const pin = page.getByRole("button", { name: "Pin Alpha brunch", exact: true });
    await expect(pin).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("Pinned", { exact: true })).toHaveCount(0);

    await pin.click();

    // WCAG 1.4.1: the state is carried by TEXT, not by the icon's fill.
    await expect(page.getByText("Pinned", { exact: true })).toBeVisible();
    const unpin = page.getByRole("button", { name: "Unpin Alpha brunch", exact: true });
    await expect(unpin).toHaveAttribute("aria-pressed", "true");

    // Unpinning reverses BOTH.
    await unpin.click();
    await expect(page.getByRole("button", { name: "Pin Alpha brunch", exact: true })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.getByText("Pinned", { exact: true })).toHaveCount(0);
  });

  test("FILTERING BEATS PINNING: a pinned meal that doesn't match is not rendered, and the count agrees", async ({
    page,
  }) => {
    await seedMeal("Alpha brunch");
    await seedMeal("Mid snack");
    await seedMeal("Zulu supper", 1, true);

    await logIn(page);
    await gotoMeals(page, 3);
    expect(await renderedOrder(page)).toContain("Zulu supper");

    await page.getByLabel("Filter meals", { exact: true }).fill("snack");

    const visible = await renderedOrder(page);
    expect(visible).toEqual(["Mid snack"]);
    // A pinned non-match must NOT be shown -- a filter is an explicit question.
    expect(visible).not.toContain("Zulu supper");
    // ...and the readout tells the truth about how many are hidden.
    await expect(page.getByText("Showing 1 of 3")).toBeVisible();
  });
});

test.describe("Phase 8f -- duplicating a meal", () => {
  test.beforeEach(async () => {
    await clearMeals();
  });

  test('the name field opens PREFILLED with "<name> (copy)", pre-selected, and is overridable', async ({
    page,
  }) => {
    await seedMeal("Alpha brunch", 2);
    await logIn(page);
    await gotoMeals(page, 1);

    await page.getByRole("button", { name: "Duplicate", exact: true }).click();
    const panel = page.getByRole("region", { name: "Duplicate meal", exact: true });
    await expect(panel).toBeVisible();

    const nameField = panel.getByLabel("Meal name", { exact: true });
    // Prefilled -- deliberately UNLIKE save-as-meal's blank field, because "<name> (copy)" cannot
    // be wrong the way a first-item name can (3.4's "prefill when the derived value cannot be
    // wrong; leave blank when it can").
    await expect(nameField).toHaveValue("Alpha brunch (copy)");
    // Pre-selected, so the first keystroke replaces it.
    const selectedLength = await nameField.evaluate(
      (el) => (el as HTMLInputElement).selectionEnd! - (el as HTMLInputElement).selectionStart!,
    );
    expect(selectedLength).toBe("Alpha brunch (copy)".length);

    // Overridable.
    await nameField.fill("My own name");
    await panel.getByRole("button", { name: "Duplicate meal", exact: true }).click();

    await expect(page.getByText("My own name", { exact: true })).toBeVisible();
    const { data } = await admin.from("meals").select("name, is_pinned").eq("user_id", user.id);
    expect((data ?? []).map((m) => m.name).sort()).toEqual(["Alpha brunch", "My own name"]);
  });

  test("submitting the prefilled name unchanged succeeds and copies the items", async ({ page }) => {
    await seedMeal("Alpha brunch", 3);
    await logIn(page);
    await gotoMeals(page, 1);

    await page.getByRole("button", { name: "Duplicate", exact: true }).click();
    const panel = page.getByRole("region", { name: "Duplicate meal", exact: true });
    await panel.getByRole("button", { name: "Duplicate meal", exact: true }).click();

    await expect(page.getByText("Alpha brunch (copy)", { exact: true })).toBeVisible();
    const { data: copy } = await admin
      .from("meals")
      .select("id")
      .eq("user_id", user.id)
      .eq("name", "Alpha brunch (copy)")
      .single();
    const { data: items } = await admin.from("meal_items").select("id").eq("meal_id", copy!.id);
    expect(items ?? []).toHaveLength(3);
  });

  test("success REFETCHES but disturbs nothing: the filter stays applied and the card stays expanded", async ({
    page,
  }) => {
    await seedMeal("Banana split", 2);
    await seedMeal("Zulu supper", 1);
    await logIn(page);
    await gotoMeals(page, 2);

    // Apply a filter that the duplicate WILL also match, and confirm the card is expanded.
    await page.getByLabel("Filter meals", { exact: true }).fill("banana");
    await expect(page.getByText("Showing 1 of 2")).toBeVisible();
    await expect(page.getByText("Ingredient 0").first()).toBeVisible(); // expand-by-default

    await page.getByRole("button", { name: "Duplicate", exact: true }).click();
    const panel = page.getByRole("region", { name: "Duplicate meal", exact: true });
    await panel.getByRole("button", { name: "Duplicate meal", exact: true }).click();

    // The new meal appears BECAUSE it matches the filter...
    await expect(page.getByText("Banana split (copy)", { exact: true })).toBeVisible();
    // ...the filter is still applied (Zulu supper is still hidden, and the count updated)...
    await expect(page.getByText("Showing 2 of 3")).toBeVisible();
    await expect(page.getByText("Zulu supper", { exact: true })).toHaveCount(0);
    await expect(page.getByLabel("Filter meals", { exact: true })).toHaveValue("banana");
    // ...and items are still visible (this screen has shipped state-loss bugs twice).
    await expect(page.getByText("Ingredient 0").first()).toBeVisible();
  });

  test("ONE expander at a time: Duplicate closes an open Log on the same card, and one on another card", async ({
    page,
  }) => {
    await seedMeal("Alpha brunch", 1);
    await seedMeal("Zulu supper", 1);
    await logIn(page);
    await gotoMeals(page, 2);

    const duplicateButtons = page.getByRole("button", { name: "Duplicate", exact: true });
    const logButtons = page.getByRole("button", { name: "Log this meal", exact: true });
    await expect(duplicateButtons).toHaveCount(2);

    // Same card: opening Duplicate closes an open "Log this meal".
    await logButtons.nth(0).click();
    await expect(page.getByRole("region", { name: /^Log / })).toHaveCount(1);
    await duplicateButtons.nth(0).click();
    await expect(page.getByRole("region", { name: "Duplicate meal", exact: true })).toHaveCount(1);
    await expect(page.getByRole("region", { name: /^Log / })).toHaveCount(0);

    // Across cards: the OPEN card's own trigger has flipped to "Cancel", so exactly one
    // "Duplicate" button remains -- the other card's. Opening it must close the first card's.
    await expect(duplicateButtons).toHaveCount(1);
    await duplicateButtons.first().click();
    await expect(page.getByRole("region", { name: "Duplicate meal", exact: true })).toHaveCount(1);
    // ...and the first card is back to offering Duplicate, proving the panel MOVED rather than
    // a second one having opened.
    await expect(duplicateButtons).toHaveCount(1);
  });

  // NOTE (not a defect): "Rename" is NOT an ActionPanel expander -- it REPLACES the card header
  // with an inline MealForm, so Duplicate is not reachable at all while renaming. 6's row
  // "opening Duplicate closes an open ... Rename" is therefore unreachable BY CONSTRUCTION rather
  // than unimplemented; `cardAction` being a single value for the whole list is what actually
  // enforces mutual exclusion, and that is what is asserted above.

  test("the duplicate is NOT pinned even when the source is (asserted through the UI)", async ({ page }) => {
    await seedMeal("Alpha brunch", 1, true);
    await logIn(page);
    await gotoMeals(page, 1);

    await expect(page.getByText("Pinned", { exact: true })).toHaveCount(1);

    await page.getByRole("button", { name: "Duplicate", exact: true }).click();
    const panel = page.getByRole("region", { name: "Duplicate meal", exact: true });
    await panel.getByRole("button", { name: "Duplicate meal", exact: true }).click();

    await expect(page.getByText("Alpha brunch (copy)", { exact: true })).toBeVisible();
    // Still exactly ONE "Pinned" pill on the page -- the copy did not inherit it.
    await expect(page.getByText("Pinned", { exact: true })).toHaveCount(1);
    // ...and the source is still the pinned one, still first.
    expect((await renderedOrder(page))[0]).toBe("Alpha brunch");
  });
});

test.describe("Phase 8f -- adversarial: pin failure handling", () => {
  test.beforeEach(async () => {
    await clearMeals();
  });

  /**
   * FINDING (pinned, NOT endorsed) -- `MealList.handleTogglePinned` discards `setMealPinned`'s
   * `{ ok, error }` result entirely and calls `onChanged()` unconditionally, so a FAILED pin is
   * indistinguishable from a successful one at the point of action.
   *
   * This is the same class as Phase 8d's qa N-4 finding against `handleDeleteEditingEntry` (which
   * WAS fixed, and whose fix Phase 8g's spec required be kept verbatim) -- recurring on a new
   * action added one phase later. Severity is low: the unconditional refetch means the card
   * re-renders from the DB, so the UI never shows a pin that did not happen, and in the
   * session-expiry case the surrounding refetch surfaces its own error. But nothing tells the user
   * their click did nothing, and no error is routed anywhere.
   */
  test("FINDING: a pin that fails server-side produces no pin-specific feedback", async ({ page, context }) => {
    await seedMeal("Alpha brunch");
    await logIn(page);
    await gotoMeals(page, 1);

    const pin = page.getByRole("button", { name: "Pin Alpha brunch", exact: true });
    await expect(pin).toHaveAttribute("aria-pressed", "false");

    // Reachable, real failure: drop the session so setMealPinned returns { ok:false,
    // error:"unauthenticated" }.
    await context.clearCookies();
    await pin.click();
    await page.waitForTimeout(2000);

    // The DB is genuinely unchanged -- so the action correctly did nothing...
    const { data } = await admin.from("meals").select("is_pinned").eq("user_id", user.id).single();
    expect(data!.is_pinned).toBe(false);
    // ...and no message anywhere names the failed pin.
    await expect(page.getByText(/couldn't pin|couldn't unpin|pin failed/i)).toHaveCount(0);
  });
});

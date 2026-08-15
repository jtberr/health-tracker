import { test, expect, type Locator, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";
import type { FoodEntry } from "../src/lib/types";

/**
 * QA-REVIEWER independent Phase 8k acceptance suite -- "The /food day-action surface: one toolbar,
 * one panel outlet, real disclosure affordances".
 *
 * Written from docs/architecture/food-weight-tracker.md 3.4 (the three Phase 8k blocks), 5's two
 * Phase 8k risk bullets and 6's "The /food day-action surface" rows -- NOT from the developer's
 * implementation or their own component tests, which were read only afterwards to look for gaps.
 *
 * The browser is pinned to UTC and every fixture is seeded on TODAY at a fixed quarter-hour time,
 * deliberately sidestepping both documented pre-existing flakes (the FoodDayView Day-input
 * navigation race, and the phase7b pastInstant UTC-midnight fixture collision).
 */

test.use({ timezoneId: "UTC" });

let user: TestUser;
let client: SupabaseClient;

test.beforeAll(async () => {
  user = await createConfirmedTestUser();
  client = await createUserClient(user);
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
  // Hydration gate: FoodDayView resolves tz/today in a mount-only Effect and renders a placeholder
  // on both the server pass and the client's first pass until it does.
  await expect(page.getByRole("button", { name: "Log a saved meal" })).toBeVisible({ timeout: 15000 });
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function todayAt(time: string): string {
  return todayUtc() + "T" + time + ":00.000Z";
}

async function seedEntry(name: string, consumedAt: string): Promise<FoodEntry> {
  const { data, error } = await client
    .from("food_entries")
    .insert({
      user_id: user.id,
      name,
      quantity: 1,
      unit: null,
      calories_per_unit: 100,
      protein_g_per_unit: 10,
      consumed_at: consumedAt,
      consumed_tz: "UTC",
    })
    .select()
    .single();
  if (error || !data) throw new Error("seedEntry failed: " + (error ? error.message : "no data"));
  return data as FoodEntry;
}

async function clearEntries() {
  await client.from("food_entries").delete().eq("user_id", user.id);
}

async function clearMeals() {
  await client.from("meals").delete().eq("user_id", user.id);
}

async function seedMeal(name: string) {
  const { data, error } = await client
    .from("meals")
    .insert({ user_id: user.id, name })
    .select()
    .single();
  if (error || !data) throw new Error("seedMeal failed: " + (error ? error.message : "no data"));
  await client.from("meal_items").insert({
    meal_id: data.id,
    user_id: user.id,
    name: "QA8k Item",
    quantity: 1,
    unit: null,
    calories_per_unit: 200,
    protein_g_per_unit: 20,
    sort_order: 0,
  });
  return data;
}

const TRIGGERS = ["Log a saved meal", "Copy this day", "Select entries"] as const;

function trigger(page: Page, name: string): Locator {
  return page.getByRole("button", { name, exact: true });
}

/** The open ActionPanel (level 3 of the emphasis ladder) -- role="region". */
function panel(page: Page, name: string): Locator {
  return page.getByRole("region", { name, exact: true });
}

test.describe("Phase 8k -- the trigger row never splits, whichever panel is open", () => {
  test.beforeEach(async () => {
    await clearEntries();
    await clearMeals();
  });

  // THE ROW TO HAMMER (6). A visibility-only assertion passes with the bug present -- the triggers
  // were always visible, they were just pushed BELOW the open panel. So this compares bounding
  // boxes, and additionally proves all three still share one container element.
  for (const opening of ["Log a saved meal", "Copy this day"]) {
    test("opening " + opening + " leaves all three triggers rendered, together, ABOVE the panel", async ({ page }) => {
      await seedEntry("QA8k Geometry", todayAt("09:00"));
      await seedMeal("QA8k Geometry Meal");
      await logIn(page);
      await expect(page.getByText("QA8k Geometry").first()).toBeVisible();

      await trigger(page, opening).click();
      const open = panel(page, opening);
      await expect(open).toBeVisible();

      const panelBox = await open.boundingBox();
      expect(panelBox, "the opened panel has a layout box").not.toBeNull();

      for (const name of TRIGGERS) {
        const btn = trigger(page, name);
        await expect(btn, name + " is still rendered with " + opening + " open").toBeVisible();
        const box = await btn.boundingBox();
        expect(box, name + " has a layout box").not.toBeNull();
        // The actual bug: the trigger wrapped onto a line BELOW the open panel.
        expect(
          box!.y + box!.height,
          name + " must sit entirely above the " + opening + " panel (was y=" + box!.y + ", panel y=" + panelBox!.y + ")",
        ).toBeLessThanOrEqual(panelBox!.y);
      }

      // ...and all three are still children of ONE shared container, not scattered.
      const sharedParents = await page.evaluate((names) => {
        const btns = names.map((n) =>
          Array.from(document.querySelectorAll("button")).find((b) => (b.textContent || "").trim() === n),
        );
        if (btns.some((b) => !b)) return null;
        // Each Button is wrapped by Tooltip's relative span; the bar is that span's parent.
        const parents = btns.map((b) => {
          const sp = b!.closest("span");
          return sp ? sp.parentElement : null;
        });
        return parents.every((p) => p && p === parents[0]);
      }, TRIGGERS.slice());
      expect(sharedParents, "all three triggers share one container element").toBe(true);
    });
  }

  test("only one day panel at a time: opening the other closes the first outright", async ({ page }) => {
    await seedEntry("QA8k OnePanel", todayAt("09:00"));
    await seedMeal("QA8k OnePanel Meal");
    await logIn(page);
    await expect(page.getByText("QA8k OnePanel").first()).toBeVisible();

    await trigger(page, "Copy this day").click();
    await expect(page.getByLabel("Copy to date")).toBeVisible();

    await trigger(page, "Log a saved meal").click();
    // GONE, not merely hidden behind the other panel.
    await expect(page.getByLabel("Copy to date")).toHaveCount(0);
    await expect(panel(page, "Copy this day")).toHaveCount(0);
    await expect(panel(page, "Log a saved meal")).toBeVisible();
  });

  test("entering select mode closes an open day panel, and the shipped trigger rule is pinned", async ({ page }) => {
    await seedEntry("QA8k Exclusive", todayAt("09:00"));
    await logIn(page);
    await expect(page.getByText("QA8k Exclusive").first()).toBeVisible();

    await trigger(page, "Copy this day").click();
    await expect(page.getByLabel("Copy to date")).toBeVisible();

    await trigger(page, "Select entries").click();

    // The day panel is gone...
    await expect(page.getByLabel("Copy to date")).toHaveCount(0);
    await expect(panel(page, "Copy this day")).toHaveCount(0);
    // ...and the SHIPPED rule (3.4: "mutually exclusive states of the same bar") is that the whole
    // toolbar is replaced by the select-mode panel. Pinned so it is deliberate, not incidental.
    for (const name of TRIGGERS) {
      await expect(trigger(page, name), name + " is hidden in select mode").toHaveCount(0);
    }
    await expect(panel(page, "Select entries")).toBeVisible();

    // ...and leaving select mode restores all three.
    await page.getByRole("button", { name: "Done", exact: true }).click();
    for (const name of TRIGGERS) {
      await expect(trigger(page, name), name + " returns after Done").toBeVisible();
    }
  });
});

test.describe("Phase 8k -- refresh survival, re-asserted against the NEW structure", () => {
  test.beforeEach(async () => {
    await clearEntries();
    await clearMeals();
  });

  // 5: "Phase 8k moves open-state ownership, which is exactly when the N-3 unmount rule gets
  // re-derived wrong." The state changed owners, so the old passing test proves nothing.
  test("a background refresh leaves the Copy-this-day panel open with its typed date intact", async ({ page }) => {
    await seedEntry("QA8k RefreshCopy", todayAt("09:00"));
    await logIn(page);
    await expect(page.getByText("QA8k RefreshCopy").first()).toBeVisible();

    await trigger(page, "Copy this day").click();
    const target = page.getByLabel("Copy to date");
    await expect(target).toBeVisible();

    // A value that is NOT the default (which is today), so a remount is detectable.
    const past = new Date();
    past.setUTCDate(past.getUTCDate() - 5);
    const typed = past.toISOString().slice(0, 10);
    await target.fill(typed);
    await expect(target).toHaveValue(typed);

    // A REAL background refresh: adding an unrelated entry calls FoodDayView.refresh().
    await page.getByLabel("Name", { exact: true }).fill("QA8k RefreshTrigger");
    await page.getByLabel("Total calories", { exact: true }).fill("123");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Entry added.")).toBeVisible();
    await expect(page.getByText("QA8k RefreshTrigger").first()).toBeVisible();

    // The panel survived, and so did the typed value.
    await expect(panel(page, "Copy this day")).toBeVisible();
    await expect(target).toHaveValue(typed);
  });

  test("a background refresh leaves the bulk save-as-meal form open with its typed name intact", async ({ page }) => {
    await seedEntry("QA8k RefreshBulkA", todayAt("09:00"));
    await seedEntry("QA8k RefreshBulkB", todayAt("10:00"));
    await logIn(page);
    await expect(page.getByText("QA8k RefreshBulkA").first()).toBeVisible();

    await trigger(page, "Select entries").click();
    await page.getByRole("checkbox", { name: /QA8k RefreshBulkA/ }).check();
    await page.getByRole("checkbox", { name: /QA8k RefreshBulkB/ }).check();
    await expect(page.getByText("2 selected")).toBeVisible();

    await page.getByRole("button", { name: "Save selected as a meal", exact: true }).click();
    const nameField = page.getByLabel("Meal name", { exact: true });
    await expect(nameField).toBeVisible();
    await nameField.fill("QA8k In Progress Name");

    // Real background refresh, from a surface that is still live in select mode.
    await page.getByLabel("Name", { exact: true }).fill("QA8k BulkRefreshTrigger");
    await page.getByLabel("Total calories", { exact: true }).fill("77");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Entry added.")).toBeVisible();
    await expect(page.getByText("QA8k BulkRefreshTrigger").first()).toBeVisible();

    // The whole select-mode panel, the chosen bulk step, the selection and the typed name survive.
    await expect(panel(page, "Save selected as a meal")).toBeVisible();
    await expect(nameField).toHaveValue("QA8k In Progress Name");
    await expect(page.getByText("2 selected")).toBeVisible();
  });
});

test.describe("Phase 8k -- select mode gets exactly one accent region", () => {
  test.beforeEach(async () => {
    await clearEntries();
    await clearMeals();
  });

  test("one region in select mode, still one after choosing a bulk action, renamed to the step", async ({ page }) => {
    await seedEntry("QA8k OneRegion", todayAt("09:00"));
    await logIn(page);
    await expect(page.getByText("QA8k OneRegion").first()).toBeVisible();

    await trigger(page, "Select entries").click();
    await expect(page.getByRole("region")).toHaveCount(1);
    await expect(panel(page, "Select entries")).toBeVisible();

    // Computed accent ring + accent-soft fill (the visual-identity suite's method).
    const styles = await panel(page, "Select entries").evaluate((el) => {
      const s = getComputedStyle(el);
      return { border: s.borderTopColor, bg: s.backgroundColor };
    });
    expect(styles.border, "--accent #1D4ED8 ring").toBe("rgb(29, 78, 216)");
    expect(styles.bg, "--accent-soft #DBEAFE fill").toBe("rgb(219, 234, 254)");

    await page.getByRole("checkbox", { name: /QA8k OneRegion/ }).check();
    await page.getByRole("button", { name: "Copy selected", exact: true }).click();

    // Still exactly ONE region -- not the bar plus a second, nested accent box.
    await expect(page.getByRole("region")).toHaveCount(1);
    await expect(panel(page, "Copy selected")).toBeVisible();
    await expect(panel(page, "Select entries")).toHaveCount(0);
  });

  test("opening a bulk form suppresses the bar four buttons but not the checkboxes", async ({ page }) => {
    await seedEntry("QA8k SuppressA", todayAt("09:00"));
    await seedEntry("QA8k SuppressB", todayAt("10:00"));
    await logIn(page);
    await expect(page.getByText("QA8k SuppressA").first()).toBeVisible();

    await trigger(page, "Select entries").click();
    await page.getByRole("checkbox", { name: /QA8k SuppressA/ }).check();
    await expect(page.getByText("1 selected")).toBeVisible();

    await page.getByRole("button", { name: "Copy selected", exact: true }).click();
    // The submit button inside the form is ALSO named "Copy selected", so assert on the three bar
    // buttons that have no counterpart inside the form.
    await expect(page.getByRole("button", { name: "Save selected as a meal", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Done", exact: true })).toHaveCount(0);
    // "Clear" -- FoodEntryForm has its own "Clear", so the bar absence means exactly one remains.
    await expect(page.getByRole("button", { name: "Clear", exact: true })).toHaveCount(1);

    // The count is still shown, and the checkboxes are still live.
    await expect(page.getByText("1 selected")).toBeVisible();
    await page.getByRole("checkbox", { name: /QA8k SuppressB/ }).check();
    await expect(page.getByText("2 selected")).toBeVisible();

    // Cancel restores all four.
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("button", { name: "Copy selected", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save selected as a meal", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Done", exact: true })).toBeVisible();
    await expect(page.getByText("2 selected")).toBeVisible();
  });

  // The property the panel key exists for. Fails SILENTLY if the remount is omitted.
  test("focus lands inside the bulk form, not on the bar, after choosing a bulk action", async ({ page }) => {
    await seedEntry("QA8k Focus", todayAt("09:00"));
    await logIn(page);
    await expect(page.getByText("QA8k Focus").first()).toBeVisible();

    await trigger(page, "Select entries").click();
    await page.getByRole("checkbox", { name: /QA8k Focus/ }).check();
    await page.getByRole("button", { name: "Save selected as a meal", exact: true }).click();

    const focused = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      if (!active) return { inRegion: false, tag: "none", id: "" };
      const region = active.closest("[role=region]");
      return { inRegion: Boolean(region), tag: active.tagName, id: active.id };
    });
    expect(focused.inRegion, "focus is inside the ActionPanel region").toBe(true);
    // Specifically the form own first field, not the collapsed bar.
    expect(focused.tag, "focused element was " + focused.tag + " id=" + focused.id).toBe("INPUT");
  });
});

test.describe("Phase 8k -- the toolbar ARIA surface and its tooltips", () => {
  test.beforeEach(async () => {
    await clearEntries();
    await clearMeals();
  });

  test("the toolbar container exposes no role=toolbar and no accessible name", async ({ page }) => {
    await seedEntry("QA8k Aria", todayAt("09:00"));
    await logIn(page);
    await expect(page.getByText("QA8k Aria").first()).toBeVisible();

    await expect(page.locator("[role=toolbar]")).toHaveCount(0);
    const container = await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find(
        (b) => (b.textContent || "").trim() === "Copy this day",
      );
      const sp = btn ? btn.closest("span") : null;
      const bar = sp ? sp.parentElement : null;
      if (!bar) return null;
      return {
        role: bar.getAttribute("role"),
        ariaLabel: bar.getAttribute("aria-label"),
        ariaLabelledBy: bar.getAttribute("aria-labelledby"),
      };
    });
    expect(container).not.toBeNull();
    expect(container!.role).toBeNull();
    expect(container!.ariaLabel).toBeNull();
    expect(container!.ariaLabelledBy).toBeNull();
  });

  test("each trigger has a supplementary tooltip that explains rather than repeats", async ({ page }) => {
    await seedEntry("QA8k Tips", todayAt("09:00"));
    await logIn(page);
    await expect(page.getByText("QA8k Tips").first()).toBeVisible();

    for (const name of TRIGGERS) {
      const described = await trigger(page, name).getAttribute("aria-describedby");
      expect(described, name + " has aria-describedby").toBeTruthy();
      const tip = page.locator(`[id="${described}"]`);
      await expect(tip, name + " description resolves to a real element").toHaveCount(1);
      await expect(tip).toHaveAttribute("role", "tooltip");
      const text = ((await tip.textContent()) || "").trim();
      expect(text.length, name + " tooltip is non-empty").toBeGreaterThan(0);
      expect(text, name + " tooltip must EXPLAIN, not repeat its own label").not.toBe(name);
    }

    // ...and the Select entries description names the target: the day log below.
    const selDescribed = await trigger(page, "Select entries").getAttribute("aria-describedby");
    const selText = ((await page.locator(`[id="${selDescribed}"]`).textContent()) || "").toLowerCase();
    expect(selText, "names the day log below").toContain("day");
    expect(selText).toContain("below");
  });
});

test.describe("Phase 8k -- disclosure buttons", () => {
  test.beforeEach(async () => {
    await clearEntries();
    await clearMeals();
  });

  const DISCLOSURES = ["Look up a food (barcode or search)", "Add detail (quantity, unit)"];

  for (const label of DISCLOSURES) {
    test(label + " is a real button whose aria-expanded/aria-controls track the panel", async ({ page }) => {
      await logIn(page);
      const btn = page.getByRole("button", { name: label, exact: true });
      await expect(btn).toBeVisible();
      await expect(btn).toHaveAttribute("aria-expanded", "false");

      const controls = await btn.getAttribute("aria-controls");
      expect(controls, "aria-controls is set").toBeTruthy();

      await btn.click();
      await expect(btn).toHaveAttribute("aria-expanded", "true");
      // aria-controls resolves to the element actually revealed.
      const revealed = page.locator(`[id="${controls}"]`);
      await expect(revealed, "aria-controls resolves to the revealed element").toHaveCount(1);
      await expect(revealed).toBeVisible();

      // The trigger STAYS rendered while open -- a regression here would be the old
      // "trigger disappears, a separate Close appears" shape.
      await expect(btn, "the trigger stays rendered while open").toBeVisible();

      // Toggling twice returns to collapsed.
      await btn.click();
      await expect(btn).toHaveAttribute("aria-expanded", "false");
      await expect(revealed).toHaveCount(0);
    });
  }

  test("FoodLookupPanel exposes exactly ONE dismissal control, not two", async ({ page }) => {
    await logIn(page);
    const btn = page.getByRole("button", { name: "Look up a food (barcode or search)", exact: true });
    await btn.click();
    const controls = await btn.getAttribute("aria-controls");
    const revealed = page.locator(`[id="${controls}"]`);
    await expect(revealed).toBeVisible();

    // The old separate "Close" link inside the panel is retired -- the trigger is the only way out.
    await expect(revealed.getByRole("button", { name: /^(Close|Cancel)$/ })).toHaveCount(0);
    await btn.click();
    await expect(revealed).toHaveCount(0);
  });

  test("the collapsed detail section still submits a manually-set quantity (Phase 6 B-1 unregressed)", async ({ page }) => {
    await logIn(page);

    await page.getByLabel("Name", { exact: true }).fill("QA8k Collapsed Qty");
    const detail = page.getByRole("button", { name: "Add detail (quantity, unit)", exact: true });
    await detail.click();
    await page.getByLabel("Quantity", { exact: true }).fill("3");
    await page.getByLabel("Unit (optional)", { exact: true }).fill("slice");
    // Default input mode for a new entry is "total" -- 3 x 50 = 150 kcal for the quantity set.
    await page.getByLabel("Total calories", { exact: true }).fill("150");
    await page.getByLabel("Total protein (g)", { exact: true }).fill("6");
    // Collapse again -- this must NOT reset quantity/unit back to 1/blank.
    await detail.click();
    await expect(page.getByLabel("Quantity", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Entry added.")).toBeVisible();

    const res = await client
      .from("food_entries")
      .select("*")
      .eq("user_id", user.id)
      .eq("name", "QA8k Collapsed Qty")
      .single();
    expect(res.data, "the entry was written").not.toBeNull();
    expect(Number(res.data!.quantity), "quantity survived the collapse").toBe(3);
    expect(res.data!.unit).toBe("slice");
    expect(Number(res.data!.calories), "3 x 50").toBe(150);
  });
});

// The design's own manual-browser check names phone width as where "the panel outlet matters
// most" -- the three triggers wrap onto multiple lines there, which is exactly the geometry the
// old fused trigger+panel shape got wrong. Asserted programmatically rather than eyeballed.
test.describe("Phase 8k -- the same geometry holds at a phone width", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("at 390px the triggers still wrap together ABOVE the open Copy-this-day panel", async ({ page }) => {
    await clearEntries();
    await clearMeals();
    await seedEntry("QA8k Phone", todayAt("09:00"));
    await logIn(page);
    await expect(page.getByText("QA8k Phone").first()).toBeVisible();

    await trigger(page, "Copy this day").click();
    const open = panel(page, "Copy this day");
    await expect(open).toBeVisible();
    const panelBox = await open.boundingBox();

    for (const name of TRIGGERS) {
      const box = await trigger(page, name).boundingBox();
      expect(box, name + " has a layout box at phone width").not.toBeNull();
      expect(
        box!.y + box!.height,
        name + " must stay above the panel at 390px (y=" + box!.y + ", panel y=" + panelBox!.y + ")",
      ).toBeLessThanOrEqual(panelBox!.y);
    }

    // ...and the panel itself is not overflowing the viewport horizontally.
    expect(panelBox!.x, "panel starts inside the viewport").toBeGreaterThanOrEqual(0);
    expect(panelBox!.x + panelBox!.width, "panel ends inside the viewport").toBeLessThanOrEqual(391);
  });
});

import { test, expect, type Locator, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";
import type { FoodEntry } from "../src/lib/types";

/**
 * QA-REVIEWER independent Phase 8e acceptance suite -- "Scanning the time picker: quarter-hour
 * option groups".
 *
 * Written from docs/architecture/food-weight-tracker.md 3.4's "Shading early and late hours in the
 * time <select>" block, 6's "Time-picker grouping" rows and 8's Phase 8e section -- NOT from the
 * developer's implementation, read only afterwards to look for gaps.
 *
 * The load-bearing property this suite enforces is Jeff's explicit constraint: NOTHING is lost.
 * All 96 options stay present, selectable, undisabled, correctly valued and correctly ordered at
 * all three call sites, and selecting one still stores the same consumed_at -- i.e. the grouping is
 * genuinely presentation-only and never reaches below the label boundary.
 *
 * Browser pinned to UTC; fixtures seeded on today at fixed times.
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

async function seedMeal(name: string) {
  const { data, error } = await client
    .from("meals")
    .insert({ user_id: user.id, name })
    .select()
    .single();
  if (error || !data) throw new Error("seedMeal failed");
  await client.from("meal_items").insert({
    meal_id: data.id,
    user_id: user.id,
    name: "QA8e Item",
    quantity: 1,
    unit: null,
    calories_per_unit: 200,
    protein_g_per_unit: 20,
    sort_order: 0,
  });
  return data;
}

async function clearAll() {
  await client.from("food_entries").delete().eq("user_id", user.id);
  await client.from("meals").delete().eq("user_id", user.id);
}

/** The 96 canonical HH:MM values, derived here independently of the app's own helper. */
function expectedValues(): string[] {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 15, 30, 45]) {
      out.push(String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0"));
    }
  }
  return out;
}

/**
 * Asserts a time <select> still exposes exactly the 96 quarter-hour options, in order, with the
 * right values, zero-padded labels, and none disabled. `extraLeading` accounts for
 * CopyGroupDialog's non-time sentinel, which sits outside/above the times.
 */
async function assertNinetySixOptions(select: Locator, extraLeading = 0) {
  // NB: a DESCENDANT selector on purpose -- a direct-child selector (`select > option`) is exactly
  // what 6 flags as breaking under <optgroup>, so this must work either way.
  const options = select.locator("option");
  await expect(options).toHaveCount(96 + extraLeading);

  const rendered = await options.evaluateAll((els) =>
    els.map((el) => {
      const o = el as HTMLOptionElement;
      return { value: o.value, label: (o.textContent ?? "").trim(), disabled: o.disabled };
    }),
  );
  const times = rendered.slice(extraLeading);
  expect(times.map((o) => o.value)).toEqual(expectedValues());
  for (const o of times) {
    expect(o.disabled, o.value + " must not be disabled").toBe(false);
    expect(o.label, o.value + " label").toMatch(/^\d{2}:\d{2} (AM|PM)$/);
  }
}

test.describe("Phase 8e -- nothing was lost, at all three call sites", () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test("FoodEntryForm's Time select exposes exactly 96 selectable options in order", async ({ page }) => {
    await logIn(page);
    // `exact: true` -- "Copy to time" and the region headings on this page all contain "Time" as a
    // case-insensitive substring (this project's documented getByLabel collision class).
    await assertNinetySixOptions(page.getByLabel("Time", { exact: true }));
  });

  test("LogMealDialog (picker mode, /food) exposes exactly 96 selectable options", async ({ page }) => {
    await seedMeal("QA8e Breakfast");
    await logIn(page);

    await page.getByRole("button", { name: "Log a saved meal", exact: true }).click();
    const panel = page.getByRole("region", { name: "Log a saved meal", exact: true });
    await expect(panel).toBeVisible();
    await assertNinetySixOptions(panel.getByLabel("Time", { exact: true }));
  });

  test("LogMealDialog (fixed-meal mode, /meals) exposes exactly 96 selectable options", async ({ page }) => {
    await seedMeal("QA8e Breakfast");
    await logIn(page);
    await page.goto("/meals");

    await page.getByRole("button", { name: "Log this meal", exact: true }).click();
    const panel = page.getByRole("region", { name: /log/i }).first();
    await expect(panel).toBeVisible();
    await assertNinetySixOptions(panel.getByLabel("Time", { exact: true }));
  });

  test("CopyGroupDialog exposes 96 times PLUS the sentinel, which sits outside/above and is the default", async ({
    page,
  }) => {
    await seedEntry("QA8e Rice", todayAt("12:30"));
    await logIn(page);

    await page.getByRole("button", { name: "Copy this group", exact: true }).click();
    const panel = page.getByRole("region", { name: "Copy this group", exact: true });
    await expect(panel).toBeVisible();

    const select = panel.getByLabel("Copy to time", { exact: true });
    // 96 times + 1 sentinel, with the sentinel FIRST (it is not a time).
    await assertNinetySixOptions(select, 1);

    const first = select.locator("option").first();
    await expect(first).toHaveAttribute("value", "");
    await expect(first).toHaveText(/keep original time/i);
    // ...and it is still the default, so today's behaviour is unchanged unless deliberately overridden.
    await expect(select).toHaveValue("");
  });
});

test.describe("Phase 8e -- grouping is presentation only (it never reaches below the label boundary)", () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test("selecting a time by value still stores exactly that consumed_at", async ({ page }) => {
    await logIn(page);

    await page.getByLabel("Name", { exact: true }).fill("QA8e Presentation");
    await page.getByLabel("Total calories", { exact: true }).fill("250");
    await page.getByLabel("Total protein (g)", { exact: true }).fill("12");
    // A LATE-group time, so an implementation that mangled the de-emphasized groups would be caught.
    await page.getByLabel("Time", { exact: true }).selectOption("21:15");
    await page.getByRole("button", { name: "Add entry", exact: true }).click();

    await expect(page.getByText("QA8e Presentation")).toBeVisible();

    const { data } = await client
      .from("food_entries")
      .select("consumed_at, consumed_local_date")
      .eq("user_id", user.id)
      .eq("name", "QA8e Presentation")
      .single();
    expect(data).toBeTruthy();
    // Browser pinned to UTC, so the stored instant is exactly today's 21:15Z.
    expect(new Date(data!.consumed_at).toISOString()).toBe(todayAt("21:15"));
    expect(data!.consumed_local_date).toBe(todayUtc());
  });

  test("an EARLY-group time is equally selectable and stores correctly", async ({ page }) => {
    await logIn(page);

    await page.getByLabel("Name", { exact: true }).fill("QA8e Early");
    await page.getByLabel("Total calories", { exact: true }).fill("100");
    await page.getByLabel("Total protein (g)", { exact: true }).fill("5");
    await page.getByLabel("Time", { exact: true }).selectOption("03:45");
    await page.getByRole("button", { name: "Add entry", exact: true }).click();

    await expect(page.getByText("QA8e Early")).toBeVisible();
    const { data } = await client
      .from("food_entries")
      .select("consumed_at")
      .eq("user_id", user.id)
      .eq("name", "QA8e Early")
      .single();
    expect(new Date(data!.consumed_at).toISOString()).toBe(todayAt("03:45"));
  });
});

test.describe("Phase 8e -- the off-grid edit invariant (the likeliest silent defect)", () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test("a legacy off-grid time is injected, SELECTED, and not silently rewritten by an unrelated edit", async ({
    page,
  }) => {
    // Seed a time that is NOT one of the 96 buckets -- the exact scenario the invariant exists for.
    const entry = await seedEntry("QA8e Offgrid", todayAt("09:07"));
    await logIn(page);

    await page.getByRole("button", { name: "Edit QA8e Offgrid", exact: true }).click();
    const select = page.getByLabel("Time", { exact: true });

    // The injected option exists, carries the real stored time, and is the SELECTED one -- if the
    // grouping had dropped it or appended it outside every group, the <select> would fall back to
    // its first option and an unrelated save would rewrite the entry's time.
    await expect(select).toHaveValue("09:07");
    const injected = select.locator('option[value="09:07"]');
    await expect(injected).toHaveCount(1);
    await expect(injected).toHaveText(/^09:07 AM$/);
    // ...and it is injected IN PLACE, not appended at the end: its neighbours bracket it.
    const values = await select.locator("option").evaluateAll((els) =>
      els.map((el) => (el as HTMLOptionElement).value),
    );
    const idx = values.indexOf("09:07");
    expect(values[idx - 1]).toBe("09:00");
    expect(values[idx + 1]).toBe("09:15");
    // 96 grid options + the 1 injected one.
    expect(values).toHaveLength(97);

    // Now edit something unrelated and submit. Whatever the server decides about the off-grid time
    // (it is rejected by the pre-existing 15-minute-grid validator, which is unchanged behaviour),
    // the STORED time must not have been rewritten.
    await page.getByLabel("Name", { exact: true }).fill("QA8e Offgrid renamed");
    await page.getByRole("button", { name: "Save changes", exact: true }).click();
    await page.waitForTimeout(1500);

    const { data } = await client
      .from("food_entries")
      .select("consumed_at")
      .eq("id", entry.id)
      .single();
    expect(new Date(data!.consumed_at).toISOString()).toBe(todayAt("09:07"));
  });

  test("an ON-grid entry gets no injected duplicate option", async ({ page }) => {
    await seedEntry("QA8e Ongrid", todayAt("09:15"));
    await logIn(page);

    await page.getByRole("button", { name: "Edit QA8e Ongrid", exact: true }).click();
    const select = page.getByLabel("Time", { exact: true });
    await expect(select).toHaveValue("09:15");
    await expect(select.locator("option")).toHaveCount(96);
    await expect(select.locator('option[value="09:15"]')).toHaveCount(1);
  });
});

test.describe("Phase 8e -- FINDINGS pinned (current shipped behaviour, NOT endorsed)", () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  /**
   * FINDING (pinned, NOT endorsed) -- Phase 8e's load-bearing mechanism is no longer in the DOM.
   *
   * 3.4 is unambiguous that "The load-bearing mechanism is three <optgroup>s, because a group label
   * is CONTENT", and that the option CSS is "a bonus", because "<option> CSS is not portable:
   * macOS Safari/Chrome largely ignore it, and every mobile browser renders the list as a native
   * platform picker that ignores author CSS entirely". Its stated failure mode is that a CSS-only
   * shading "would work on Windows/Linux Chrome, Edge and Firefox -- where Jeff would see it work
   * -- and SILENTLY DO NOTHING on his phone".
   *
   * Two later "trivial bugfix" passes removed first the <optgroup> label text (2026-08-09, recorded
   * in ai-context/DECISIONS.md) and then the <optgroup> ELEMENT itself (2026-08-10, recorded only
   * in a code comment). What ships today is exactly the CSS-only shading the design explicitly
   * rejected. This test pins that so the state of the feature is on the record and cannot drift
   * further unnoticed; it is a question for Jeff, not a claim that the code is wrong.
   */
  test("FINDING: no <optgroup> survives at any of the three call sites (the portable mechanism is gone)", async ({
    page,
  }) => {
    await seedEntry("QA8e Rice", todayAt("12:30"));
    await seedMeal("QA8e Breakfast");
    await logIn(page);

    // FoodEntryForm
    expect(await page.getByLabel("Time", { exact: true }).locator("optgroup").count()).toBe(0);

    // LogMealDialog, picker mode
    await page.getByRole("button", { name: "Log a saved meal", exact: true }).click();
    const logPanel = page.getByRole("region", { name: "Log a saved meal", exact: true });
    await expect(logPanel).toBeVisible();
    expect(await logPanel.getByLabel("Time", { exact: true }).locator("optgroup").count()).toBe(0);
    await logPanel.getByRole("button", { name: "Cancel", exact: true }).click();

    // CopyGroupDialog
    await page.getByRole("button", { name: "Copy this group", exact: true }).click();
    const copyPanel = page.getByRole("region", { name: "Copy this group", exact: true });
    await expect(copyPanel).toBeVisible();
    expect(await copyPanel.getByLabel("Copy to time", { exact: true }).locator("optgroup").count()).toBe(0);
  });

  /**
   * FINDING (pinned, NOT endorsed) -- the surviving de-emphasis is an <option> BACKGROUND class,
   * which is the non-portable half. Recorded in DECISIONS.md (2026-08-09, Jeff's explicit call to
   * reverse "a background fill was rejected in favour of colour"), so the CHANGE is documented;
   * what is pinned here is simply that this is now the ONLY remaining shading mechanism.
   */
  test("FINDING: de-emphasis survives only as an option background class on Early/Late", async ({ page }) => {
    await logIn(page);
    const select = page.getByLabel("Time", { exact: true });

    const shaded = await select.locator("option").evaluateAll((els) =>
      els.map((el) => {
        const o = el as HTMLOptionElement;
        return { value: o.value, cls: o.className };
      }),
    );
    const early = shaded.find((o) => o.value === "03:00")!;
    const daytime = shaded.find((o) => o.value === "12:00")!;
    const late = shaded.find((o) => o.value === "22:00")!;
    const eightPm = shaded.find((o) => o.value === "20:00")!;

    expect(early.cls).toContain("bg-slate-100");
    expect(late.cls).toContain("bg-slate-100");
    expect(daytime.cls).not.toContain("bg-slate-100");
    // 20:00 itself is deliberately UNSHADED (the 2026-08-10 boundary move -- see the unit suite's
    // matching FINDING; the design doc still says 20:00 is Late).
    expect(eightPm.cls).not.toContain("bg-slate-100");
    // The 2026-08-05 text-colour de-emphasis is gone (superseded 2026-08-09).
    expect(early.cls).not.toContain("text-stone-500");
  });
});

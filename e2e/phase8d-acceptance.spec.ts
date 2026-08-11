import { test, expect, type Locator, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";
import { createAdminClient } from "./helpers/admin-client";
import type { FoodEntry } from "../src/lib/types";

/**
 * QA-REVIEWER independent Phase 8d acceptance suite -- "Day navigation, and emphasis/action
 * hygiene on the day's log".
 *
 * Written from docs/architecture/food-weight-tracker.md 3.4 (the four Phase 8d blocks), 6's
 * "Day navigation" / "Active-group suppression and action-panel emphasis" / "Icon buttons and
 * tooltips" rows and 8 Phase 8d's own In/Out scope, plus the newest ai-context/DECISIONS.md
 * entries -- NOT from the developer's own component tests, read only afterwards to find gaps.
 *
 * Fixtures are seeded on TODAY at fixed quarter-hour times and day changes are driven through the
 * NEW buttons wherever possible (6: "prefer these buttons over .fill() in new rows"), which
 * sidesteps the documented pre-existing Day-input race without claiming to fix it.
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

function dayAt(date: string, time: string): string {
  return date + "T" + time + ":00.000Z";
}

function todayAt(time: string): string {
  return dayAt(todayUtc(), time);
}

type SeedEntry = {
  name: string;
  caloriesPerUnit: number;
  proteinGPerUnit: number;
  consumedAt: string;
};

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
        quantity: 1,
        unit: null,
        calories_per_unit: r.caloriesPerUnit,
        protein_g_per_unit: r.proteinGPerUnit,
        consumed_at: r.consumedAt,
        consumed_tz: "UTC",
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

function row(page: Page, name: string): Locator {
  return page.locator("li").filter({ hasText: name });
}

function group(page: Page, name: string): Locator {
  return page.locator("section").filter({ hasText: name });
}

async function awaitDayView(page: Page) {
  await expect(page.locator("#food-day")).toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("button", { name: /Previous day/ })).toBeEnabled();
}

const prevDay = (page: Page) => page.getByRole("button", { name: /Previous day/ });
const nextDay = (page: Page) => page.getByRole("button", { name: /Next day/ });

// ---------------------------------------------------------------------------------------------
// Day navigation
// ---------------------------------------------------------------------------------------------

test.describe("Phase8d QA: day navigation", () => {
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

  test("it moves the day on /food: Previous shows the previous day SEEDED data, Next returns", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8d Today Food", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("12:00") },
      { name: "QA8d Yesterday Food", caloriesPerUnit: 200, proteinGPerUnit: 9, consumedAt: dayAt(utcDateOffset(-1), "12:00") },
    ]);
    await page.goto("/food");
    await awaitDayView(page);
    await expect(page.getByText("QA8d Today Food")).toBeVisible();

    await prevDay(page).click();
    // Asserted against real seeded data for that day, not merely the input value: a control that
    // relabels without refetching would pass a value-only assertion.
    await expect(page.getByText("QA8d Yesterday Food")).toBeVisible();
    await expect(page.getByText("QA8d Today Food")).toHaveCount(0);
    await expect(page.locator("#food-day")).toHaveValue(utcDateOffset(-1));

    await nextDay(page).click();
    await expect(page.getByText("QA8d Today Food")).toBeVisible();
    await expect(page.getByText("QA8d Yesterday Food")).toHaveCount(0);
    await expect(page.locator("#food-day")).toHaveValue(todayUtc());
  });

  test("it moves the day on /metrics too, against seeded data -- the same shared control", async ({ page }) => {
    await client.from("daily_metrics").insert([
      { user_id: user.id, metric_date: todayUtc(), weight_kg: 80 },
      { user_id: user.id, metric_date: utcDateOffset(-1), weight_kg: 71.5 },
    ]);
    await page.goto("/metrics");
    await expect(page.locator("#metric-day")).toBeVisible({ timeout: 20000 });
    await expect(page.getByLabel(/Weight/)).toHaveValue("80");

    await prevDay(page).click();
    await expect(page.locator("#metric-day")).toHaveValue(utcDateOffset(-1));
    await expect(page.getByLabel(/Weight/)).toHaveValue("71.5");

    await nextDay(page).click();
    await expect(page.getByLabel(/Weight/)).toHaveValue("80");
  });

  test("THE CAP: Next day is disabled on today and enabled on a past day, on BOTH screens", async ({ page }) => {
    for (const path of ["/food", "/metrics"]) {
      const id = path === "/food" ? "#food-day" : "#metric-day";
      await page.goto(path);
      await expect(page.locator(id)).toBeVisible({ timeout: 20000 });
      await expect(nextDay(page)).toBeDisabled();
      await prevDay(page).click();
      await expect(page.locator(id)).toHaveValue(utcDateOffset(-1));
      await expect(nextDay(page)).toBeEnabled();
      await nextDay(page).click();
      await expect(nextDay(page)).toBeDisabled();
    }
  });

  test("THE CAP, adversarially (a): re-enabling Next day in the DOM and clicking it on today does not move the day at all", async ({ page }) => {
    await page.goto("/food");
    await awaitDayView(page);
    await expect(nextDay(page)).toBeDisabled();

    // Strip the attribute AND the property, then try every activation route.
    await nextDay(page).evaluate((el) => {
      el.removeAttribute("disabled");
      (el as HTMLButtonElement).disabled = false;
    });
    await nextDay(page).click({ force: true });
    await page.waitForTimeout(400);
    await nextDay(page).dispatchEvent("click");
    await page.waitForTimeout(400);
    await nextDay(page).focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);

    // React still holds disabled in its own props, so no handler runs: the day never moves.
    await expect(page.locator("#food-day")).toHaveValue(todayUtc());
  });

  test("THE CAP, adversarially (b): even when a future day IS reached by stripping the date input max, nothing future can be LOGGED", async ({ page }) => {
    await page.goto("/food");
    await awaitDayView(page);

    // The date input is the reachable tamper path (max is only a validation hint).
    await page.locator("#food-day").evaluate((el) => el.removeAttribute("max"));
    await page.locator("#food-day").fill(utcDateOffset(1));
    await page.waitForTimeout(800);

    await page.getByLabel("Name", { exact: true }).fill("QA8d Future Attempt");
    await page.getByLabel(/calories/i).first().fill("123");
    await page.getByLabel(/protein/i).first().fill("4");
    // Strip the form's own max too, and force the date field to tomorrow.
    const formDate = page.getByLabel("Date", { exact: true });
    await formDate.evaluate((el) => el.removeAttribute("max"));
    await formDate.fill(utcDateOffset(1));
    await page.getByRole("button", { name: "Add entry" }).click();
    await page.waitForTimeout(2500);

    // The invariant: the server-side cap, not the widget.
    const rows = await entriesForUser(user.id);
    for (const r of rows) {
      expect(r.consumed_local_date <= todayUtc(), "no row may be dated after today").toBe(true);
    }
    expect(rows.filter((r) => r.consumed_local_date > todayUtc())).toEqual([]);
  });

  test("there are exactly two navigation buttons and NO Today control (dropped by decision)", async ({ page }) => {
    for (const path of ["/food", "/metrics"]) {
      const id = path === "/food" ? "#food-day" : "#metric-day";
      await page.goto(path);
      await expect(page.locator(id)).toBeVisible({ timeout: 20000 });
      const nav = page.locator("div").filter({ has: page.locator(id) }).last();
      await expect(nav.getByRole("button")).toHaveCount(2);
      await expect(prevDay(page)).toHaveCount(1);
      await expect(nextDay(page)).toHaveCount(1);
      // Absence asserted so it cannot reappear undocumented.
      await expect(page.getByRole("button", { name: /^Today$/ })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /jump to today/i })).toHaveCount(0);
      // The date input is KEPT, not replaced.
      await expect(page.locator(id)).toHaveAttribute("type", "date");
    }
  });

  test("month boundaries work END-TO-END: navigating back across the 1st renders the previous month seeded entry", async ({ page }) => {
    const now = new Date();
    const firstOfThisMonth = now.toISOString().slice(0, 8) + "01";
    const lastOfPrevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0))
      .toISOString()
      .slice(0, 10);

    await seedEntries(client, user, [
      { name: "QA8d First Of Month", caloriesPerUnit: 10, proteinGPerUnit: 1, consumedAt: dayAt(firstOfThisMonth, "09:00") },
      { name: "QA8d Last Of Prev Month", caloriesPerUnit: 20, proteinGPerUnit: 2, consumedAt: dayAt(lastOfPrevMonth, "09:00") },
    ]);

    await page.goto("/food");
    await awaitDayView(page);
    const daysBack =
      (Date.parse(todayUtc() + "T00:00:00Z") - Date.parse(firstOfThisMonth + "T00:00:00Z")) / 86400000;
    for (let i = 0; i < daysBack; i++) await prevDay(page).click();
    await expect(page.locator("#food-day")).toHaveValue(firstOfThisMonth);
    await expect(page.getByText("QA8d First Of Month")).toBeVisible();

    await prevDay(page).click();
    await expect(page.locator("#food-day")).toHaveValue(lastOfPrevMonth);
    await expect(page.getByText("QA8d Last Of Prev Month")).toBeVisible();
  });

  test("THE CHOKE POINT: pressing Previous clears select mode, the selection AND the in-progress edit", async ({ page }) => {
    await seedEntries(client, user, [
      { name: "QA8d Choke One", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("08:00") },
      { name: "QA8d Choke Two", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("09:00") },
    ]);
    await page.goto("/food");
    await awaitDayView(page);

    await row(page, "QA8d Choke Two").getByRole("button", { name: "Edit" }).click();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();

    await page.getByRole("button", { name: "Select entries" }).click();
    await page.getByRole("checkbox", { name: /QA8d Choke One/ }).check();
    await expect(page.getByText("1 selected")).toBeVisible();

    await prevDay(page).click();

    // A navigator wired to setSelectedDate instead of handleDayChange passes every other row here.
    await expect(page.getByText(/^\d+ selected$/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Done" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add entry" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------
// Active-group suppression + ActionPanel emphasis
// ---------------------------------------------------------------------------------------------

test.describe("Phase8d QA: active-group suppression and ActionPanel emphasis", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
    await seedEntries(client, user, [
      { name: "QA8d GrpA One", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("08:00") },
      { name: "QA8d GrpA Two", caloriesPerUnit: 150, proteinGPerUnit: 6, consumedAt: todayAt("08:00") },
      { name: "QA8d GrpB One", caloriesPerUnit: 200, proteinGPerUnit: 7, consumedAt: todayAt("12:00") },
    ]);
    await page.goto("/food");
    await awaitDayView(page);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  for (const kind of ["Copy this group", "Save as meal"] as const) {
    test(kind + " open: that group rows hide Log again/Edit while ANOTHER group stays fully live and still works", async ({ page }) => {
      const a = group(page, "QA8d GrpA One");
      const b = group(page, "QA8d GrpB One");
      await a.getByRole("button", { name: kind }).click();

      for (const name of ["QA8d GrpA One", "QA8d GrpA Two"]) {
        await expect(row(page, name).getByRole("button", { name: "Log again" })).toHaveCount(0);
        await expect(row(page, name).getByRole("button", { name: "Edit" })).toHaveCount(0);
        await expect(row(page, name).getByRole("button", { name: "Delete" })).toHaveCount(0);
      }

      await expect(row(page, "QA8d GrpB One").getByRole("button", { name: "Log again" })).toHaveCount(1);
      await expect(row(page, "QA8d GrpB One").getByRole("button", { name: "Edit" })).toHaveCount(1);
      // 2026-08-07 (Phase 8g): Delete is back on the row too -- an inactive group's rows keep it.
      await expect(row(page, "QA8d GrpB One").getByRole("button", { name: "Delete" })).toHaveCount(1);
      await expect(b.getByRole("button", { name: "Save as meal" })).toHaveCount(1);
      await expect(b.getByRole("button", { name: "Copy this group" })).toHaveCount(1);

      // ...and the other group action still actually works while this one is open.
      const before = (await entriesForUser(user.id)).length;
      await row(page, "QA8d GrpB One").getByRole("button", { name: "Log again" }).click();
      await expect(page.getByText(/Logged .QA8d GrpB One. again/)).toBeVisible();
      expect((await entriesForUser(user.id)).length).toBe(before + 1);
    });

    test(kind + " open: the header SIBLING action is hidden, and exactly ONE Cancel remains in that group (header reads Close)", async ({ page }) => {
      const a = group(page, "QA8d GrpA One");
      const sibling = kind === "Copy this group" ? "Save as meal" : "Copy this group";
      await a.getByRole("button", { name: kind }).click();

      await expect(a.getByRole("button", { name: sibling })).toHaveCount(0);
      await expect(a.getByRole("button", { name: "Close" })).toHaveCount(1);
      // Closes Phase 7b N-3 / Phase 8 N-5: a strict-mode collision was the failure it caused.
      await expect(a.getByRole("button", { name: "Cancel" })).toHaveCount(1);
    });
  }
});

test.describe("Phase8d QA: ActionPanel emphasis", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
    await seedEntries(client, user, [
      { name: "QA8d GrpA One", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("08:00") },
      { name: "QA8d GrpA Two", caloriesPerUnit: 150, proteinGPerUnit: 6, consumedAt: todayAt("08:00") },
      { name: "QA8d GrpB One", caloriesPerUnit: 200, proteinGPerUnit: 7, consumedAt: todayAt("12:00") },
    ]);
    await page.goto("/food");
    await awaitDayView(page);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("exactly ONE section carries the accent while an expander is open, and NONE when all are closed", async ({ page }) => {
    const accented = async () =>
      await page.locator("section").evaluateAll(
        (els) => els.filter((el) => Number.parseFloat(getComputedStyle(el).borderLeftWidth) >= 4).length,
      );

    expect(await accented()).toBe(0);
    await group(page, "QA8d GrpA One").getByRole("button", { name: "Copy this group" }).click();
    await expect(page.getByLabel("Copy to date")).toBeVisible();
    expect(await accented()).toBe(1);

    // Opening group B closes group A: still exactly one.
    await group(page, "QA8d GrpB One").getByRole("button", { name: "Save as meal" }).click();
    await expect(page.getByLabel("Meal name")).toBeVisible();
    expect(await accented()).toBe(1);

    await page.getByRole("button", { name: "Close" }).click();
    expect(await accented()).toBe(0);
  });

  test("the accent is an --accent LEFT bar with NO surface fill (so the accent-soft badge cannot be swallowed)", async ({ page }) => {
    await group(page, "QA8d GrpA One").getByRole("button", { name: "Copy this group" }).click();
    await expect(page.getByLabel("Copy to date")).toBeVisible();
    const styles = await page
      .locator("section")
      .filter({ hasText: "QA8d GrpA One" })
      .first()
      .evaluate((el) => {
        const s = getComputedStyle(el);
        return { left: s.borderLeftWidth, color: s.borderLeftColor, bg: s.backgroundColor };
      });
    expect(Number.parseFloat(styles.left)).toBeGreaterThanOrEqual(4);
    // --accent is #1D4ED8 (2026-08-09/10, Phase 8i -- was --sage-deep #5C7444).
    expect(styles.color).toBe("rgb(29, 78, 216)");
    expect(styles.bg).toBe("rgb(255, 255, 255)");
  });
});

test.describe("Phase8d QA: ActionPanel wiring, exclusions and unmount rules", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
    await seedEntries(client, user, [
      { name: "QA8d GrpA One", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("08:00") },
      { name: "QA8d GrpB One", caloriesPerUnit: 200, proteinGPerUnit: 7, consumedAt: todayAt("12:00") },
    ]);
    await page.goto("/food");
    await awaitDayView(page);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  const openers: { heading: string; open: (p: Page) => Promise<void> }[] = [
    {
      heading: "Copy this group",
      open: async (p) => {
        await group(p, "QA8d GrpA One").getByRole("button", { name: "Copy this group" }).click();
      },
    },
    {
      heading: "Save as meal",
      open: async (p) => {
        await group(p, "QA8d GrpA One").getByRole("button", { name: "Save as meal" }).click();
      },
    },
    {
      heading: "Copy this day",
      open: async (p) => {
        await p.getByRole("button", { name: "Copy this day" }).click();
      },
    },
    {
      heading: "Copy selected",
      open: async (p) => {
        await p.getByRole("button", { name: "Select entries" }).click();
        await p.getByRole("checkbox", { name: /QA8d GrpA One/ }).check();
        await p.getByRole("button", { name: "Copy selected" }).click();
      },
    },
    {
      heading: "Save selected as a meal",
      open: async (p) => {
        await p.getByRole("button", { name: "Select entries" }).click();
        await p.getByRole("checkbox", { name: /QA8d GrpA One/ }).check();
        await p.getByRole("button", { name: "Save selected as a meal" }).click();
      },
    },
  ];

  for (const c of openers) {
    test("ActionPanel on " + c.heading + ": role=region + aria-labelledby heading, accent ring + accent-soft fill (COMPUTED), focus lands inside", async ({ page }) => {
      await c.open(page);
      const region = page.getByRole("region", { name: c.heading });
      await expect(region).toHaveCount(1);

      const styles = await region.evaluate((el) => {
        const s = getComputedStyle(el);
        return { bw: s.borderTopWidth, bc: s.borderTopColor, bg: s.backgroundColor };
      });
      // Computed, not source classes: a class Tailwind never emitted would prove nothing.
      expect(Number.parseFloat(styles.bw)).toBeGreaterThan(0);
      // --accent / --accent-soft (2026-08-09/10, Phase 8i -- was --sage-deep / --sage-pale).
      expect(styles.bc).toBe("rgb(29, 78, 216)");
      expect(styles.bg).toBe("rgb(219, 234, 254)");

      // Focus moved into the panel on open -- the part that serves keyboard/SR users.
      const focusInside = await region.evaluate((el) => el.contains(document.activeElement));
      expect(focusInside, "focus should land inside " + c.heading).toBe(true);
    });
  }
});

test.describe("Phase8d QA: ActionPanel exclusions and combined unmount/refresh rules", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
    await seedEntries(client, user, [
      { name: "QA8d GrpA One", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("08:00") },
      { name: "QA8d GrpB One", caloriesPerUnit: 200, proteinGPerUnit: 7, consumedAt: todayAt("12:00") },
    ]);
    await page.goto("/food");
    await awaitDayView(page);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("the EXCLUDED surfaces stay excluded: FoodEntryForm, Add detail and FoodLookupPanel are NOT wrapped", async ({ page }) => {
    // A blanket application would pass every emphasis row above and defeat the point.
    await page.getByRole("button", { name: /Add detail/ }).click();
    await page.getByRole("button", { name: /Look up a food/ }).click();
    await expect(page.getByRole("button", { name: /^Search$/ })).toBeVisible();

    for (const h of ["Add entry", "Add detail", "Look up a food", "Search", "Barcode"]) {
      await expect(page.getByRole("region", { name: h })).toHaveCount(0);
    }
    // The primary entry form itself is not inside any region...
    const formInRegion = await page
      .locator("form")
      .filter({ has: page.getByRole("button", { name: "Add entry" }) })
      .first()
      .evaluate((el) => !!el.closest('[role="region"]'));
    expect(formInRegion).toBe(false);
    // ...and neither is the lookup panel.
    const lookupInRegion = await page
      .getByRole("button", { name: /^Search$/ })
      .evaluate((el) => !!el.closest('[role="region"]'));
    expect(lookupInRegion).toBe(false);
    // Exactly zero regions exist while only excluded surfaces are open.
    await expect(page.getByRole("region")).toHaveCount(0);
  });

  test("N-3 close/reopen AND refresh-survival hold TOGETHER for a newly-wrapped group panel", async ({ page }) => {
    const a = group(page, "QA8d GrpA One");
    await a.getByRole("button", { name: "Save as meal" }).click();
    await a.getByLabel("Meal name").fill("QA8d survives");

    // Force a REAL background refresh through the app, from outside this panel.
    await row(page, "QA8d GrpB One").getByRole("button", { name: "Log again" }).click();
    await expect(page.getByText(/Logged .QA8d GrpB One. again/)).toBeVisible();

    // (a) refresh survival: the open panel keeps its in-flight state.
    await expect(a.getByLabel("Meal name")).toHaveValue("QA8d survives");
    await expect(page.getByRole("region", { name: "Save as meal" })).toHaveCount(1);

    // (b) N-3: closing and reopening gives a FRESH panel, with no stale state carried over.
    await a.getByRole("button", { name: "Close" }).click();
    await expect(a.getByLabel("Meal name")).toHaveCount(0);
    await a.getByRole("button", { name: "Save as meal" }).click();
    await expect(a.getByLabel("Meal name")).toHaveValue("");
  });

  test("N-3 on CopyDayDialog specifically: an error shown before closing is NOT still displayed on reopen", async ({ page }) => {
    await page.getByRole("button", { name: "Copy this day" }).click();
    const panel = page.getByRole("region", { name: "Copy this day" });
    await expect(panel).toBeVisible();

    // Force a rejected copy: strip max, pick tomorrow, submit.
    await panel.getByLabel(/Copy to date/).evaluate((el) => el.removeAttribute("max"));
    await panel.getByLabel(/Copy to date/).fill(utcDateOffset(1));
    await panel.getByRole("button", { name: /^Copy/ }).click();
    await expect(panel.getByText(/later than today|Something went wrong/i).first()).toBeVisible();

    await panel.getByRole("button", { name: /Cancel|Close/ }).first().click();
    await expect(page.getByRole("region", { name: "Copy this day" })).toHaveCount(0);
    await page.getByRole("button", { name: "Copy this day" }).click();
    const reopened = page.getByRole("region", { name: "Copy this day" });
    await expect(reopened.getByText(/later than today|Something went wrong/i)).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Icon buttons + tooltips
// ---------------------------------------------------------------------------------------------

test.describe("Phase8d QA: icon buttons and tooltips", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
    await seedEntries(client, user, [
      { name: "QA8d Icon One", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("08:00") },
      { name: "QA8d Icon Two", caloriesPerUnit: 200, proteinGPerUnit: 8, consumedAt: todayAt("12:00") },
    ]);
    await page.goto("/food");
    await awaitDayView(page);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  // SUPERSEDED 2026-08-07 (Phase 8g): this row previously required Log again/Edit to keep a
  // LAID-OUT VISIBLE label at every breakpoint (the touch-explainability argument for icon+label).
  // Jeff reviewed that exact tradeoff and confirmed he still wants the label gone -- all three row
  // actions (now including Delete) are icon-only at EVERY breakpoint, named by aria-label instead.
  // Rewritten per design doc §8 Phase 8g ("must be rewritten, not deleted or left red"), not
  // silently dropped -- see ai-context/DECISIONS.md's "Icons replace buttons+text entirely...".
  test("as of Phase 8g the row actions are ICON-ONLY (no laid-out visible text) at every phone-sized viewport, named by aria-label instead", async ({ page }) => {
    for (const width of [390, 360, 320]) {
      await page.setViewportSize({ width, height: 740 });
      await page.goto("/food");
      await awaitDayView(page);

      for (const verb of ["Log again", "Edit", "Delete"]) {
        const button = row(page, "QA8d Icon One").getByRole("button", { name: new RegExp(verb) });
        await expect(button).toBeVisible();
        expect(await button.getAttribute("aria-label")).toMatch(new RegExp("^" + verb));
        // Assert there is genuinely NO laid-out visible text -- the inverse of what this row used
        // to require, and the actual regression an icon+label leftover would produce.
        const visibleText = await button.evaluate((el) => {
          const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
          let text = "";
          let node = walker.nextNode();
          while (node) {
            const parent = node.parentElement;
            if (parent) {
              const s = getComputedStyle(parent);
              const r = parent.getBoundingClientRect();
              const clipped = s.clip === "rect(0px, 0px, 0px, 0px)" || s.clipPath === "inset(50%)";
              if (s.display !== "none" && s.visibility !== "hidden" && !clipped && r.width > 1 && r.height > 1) {
                text += node.textContent ?? "";
              }
            }
            node = walker.nextNode();
          }
          return text.replace(/\s+/g, " ").trim();
        });
        expect(visibleText, verb + " must render NO laid-out visible text at " + width + "px").toBe("");
      }
    }
  });
});

test.describe("Phase8d QA: row density, ARIA and tooltip wiring", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
    await seedEntries(client, user, [
      { name: "QA8d Icon One", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("08:00") },
      { name: "QA8d Icon Two", caloriesPerUnit: 200, proteinGPerUnit: 8, consumedAt: todayAt("12:00") },
    ]);
    await page.goto("/food");
    await awaitDayView(page);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  // SUPERSEDED 2026-08-07 (Phase 8g): this row previously required Delete to be ABSENT from the
  // row and present only inside the edit form. Jeff's read, after actually using that placement,
  // is that "edit an item in order to delete it" is an unintuitive extra step, not a safety
  // feature -- Delete moves back onto the row as a third icon-only action, guarded by a
  // window.confirm instead. Rewritten per design doc §8 Phase 8g, not deleted or left red -- see
  // ai-context/DECISIONS.md's "Delete returns to the food-entry row...".
  test("the row is THREE icon-only actions: Delete is back on the row, guarded by a confirm -- dismissing it deletes nothing, accepting it does", async ({ page }) => {
    const r = row(page, "QA8d Icon One");
    await expect(r.getByRole("button")).toHaveCount(3);
    // The edit form no longer has a Delete control of its own at all.
    await expect(page.getByRole("button", { name: "Delete entry" })).toHaveCount(0);

    const del = r.getByRole("button", { name: /^Delete/ });
    // danger variant => red text, and it carries the trash glyph.
    // Tailwind v4 emits red-600 as oklch, so computed colour is a lab() string -- compare against
    // a reference element coloured with the literal hex, normalised by the SAME browser.
    const isRed600 = await del.evaluate((el) => {
      const probe = document.createElement("span");
      probe.className = "text-red-600";
      document.body.appendChild(probe);
      const ref = getComputedStyle(probe).color;
      const actual = getComputedStyle(el).color;
      probe.remove();
      return actual === ref;
    });
    expect(isRed600, "the row's Delete button must use the danger red").toBe(true);
    expect(await del.locator("svg").count()).toBe(1);

    // Dismissing the confirm deletes nothing -- the safety row.
    page.once("dialog", (dialog) => dialog.dismiss());
    await del.click();
    await expect(page.getByText("QA8d Icon One")).toBeVisible();
    expect((await entriesForUser(user.id)).map((x) => x.name)).toContain("QA8d Icon One");

    // Accepting it does, and the day's other entry survives untouched.
    page.once("dialog", (dialog) => dialog.accept());
    await del.click();
    await expect(page.getByText("QA8d Icon One")).toHaveCount(0);
    const rows = await entriesForUser(user.id);
    expect(rows.map((x) => x.name)).toEqual(["QA8d Icon Two"]);
  });

  test("icon-only buttons are correctly named: aria-label starts with the same verb, glyphs stay aria-hidden, and no visible text remains", async ({ page }) => {
    for (const verb of ["Log again", "Edit", "Delete"]) {
      const button = row(page, "QA8d Icon One").getByRole("button", { name: new RegExp(verb) });
      const info = await button.evaluate((el) => ({
        text: (el.textContent ?? "").trim(),
        ariaLabel: el.getAttribute("aria-label"),
        svgHidden: Array.from(el.querySelectorAll("svg")).map((s) => s.getAttribute("aria-hidden")),
        svgFocusable: Array.from(el.querySelectorAll("svg")).map((s) => s.getAttribute("focusable")),
      }));
      // No visible text left at all (2026-08-07, Phase 8g) -- the accessible name comes entirely
      // from aria-label now, and it must not paraphrase the verb (so voice control's "click
      // Delete" still resolves).
      expect(info.text).toBe("");
      expect(info.ariaLabel, "an icon-only button must be named by aria-label").toMatch(
        new RegExp("^" + verb),
      );
      expect(info.svgHidden).toEqual(["true"]);
      expect(info.svgFocusable).toEqual(["false"]);
    }

    // DayNavigator chevrons are icon-only too (2026-08-10 amendment, superseding this Phase 8d
    // assertion that they were real visible text -- see ai-context/DECISIONS.md): the aria-label
    // now carries the exact former label text, and no visible text remains.
    for (const label of ["Previous day", "Next day"]) {
      const b = page.getByRole("button", { name: new RegExp(label) });
      expect(await b.getAttribute("aria-label")).toBe(label);
      expect(((await b.textContent()) ?? "").trim()).not.toBe(label);
      expect(await b.locator('[aria-hidden="true"]').count()).toBe(1);
    }

    // ...and there's no longer an edit-form Delete at all to check.
    await row(page, "QA8d Icon One").getByRole("button", { name: /Edit/ }).click();
    await expect(page.getByRole("button", { name: "Delete entry" })).toHaveCount(0);
  });
});

test.describe("Phase8d QA: tooltip behaviour on a pointer device", () => {
  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
    await seedEntries(client, user, [
      { name: "QA8d Tip One", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("08:00") },
    ]);
    await page.goto("/food");
    await awaitDayView(page);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("supplementary and correctly wired: hover reveals role=tooltip whose text DIFFERS from the label, aria-describedby points at it, focus reveals it, Escape dismisses", async ({ page }) => {
    const button = row(page, "QA8d Tip One").getByRole("button", { name: "Log again" });
    const describedBy = await button.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const tip = page.locator('[id="' + describedBy + '"]');
    await expect(tip).toHaveAttribute("role", "tooltip");
    await expect(tip).toBeHidden();

    await button.hover();
    await expect(tip).toBeVisible({ timeout: 3000 });
    const text = ((await tip.textContent()) ?? "").trim();
    expect(text.length).toBeGreaterThan(0);
    // It EXPLAINS, it does not repeat (repeating the label would be noise).
    expect(text).not.toBe("Log again");
    expect(text.length).toBeGreaterThan("Log again".length);

    await page.mouse.move(0, 0);
    await expect(tip).toBeHidden();

    // Keyboard focus shows it with no delay...
    await button.focus();
    await expect(tip).toBeVisible();
    // ...and Escape dismisses it while focused (WCAG 1.4.13).
    await page.keyboard.press("Escape");
    await expect(tip).toBeHidden();

    // Both row buttons have DISTINCT descriptions.
    const editBtn = row(page, "QA8d Tip One").getByRole("button", { name: "Edit" });
    const editTipId = await editBtn.getAttribute("aria-describedby");
    expect(editTipId).not.toBe(describedBy);
    const editText = ((await page.locator('[id="' + editTipId + '"]').textContent()) ?? "").trim();
    expect(editText).not.toBe(text);
    expect(editText).not.toBe("Edit");
  });

  // SUPERSEDED 2026-08-07 (Phase 8g): this row previously asserted both row actions stayed
  // VISUALLY identifiable (a laid-out label) with tooltips suppressed. As of Phase 8g the label is
  // gone entirely -- the aria-label, not visible text, is what makes the tooltip genuinely
  // supplementary now (removing it can't erase the control's name, only its extra explanatory
  // sentence). Rewritten per design doc §8 Phase 8g, not deleted or left red.
  test("the tooltip is NOT the only source of meaning: with tooltips suppressed via CSS, both row actions stay NAMED (aria-label) and usable", async ({ page }) => {
    await page.addStyleTag({ content: '[role="tooltip"] { display: none !important; }' });
    const r = row(page, "QA8d Tip One");
    const logAgain = r.getByRole("button", { name: /Log again/ });
    const edit = r.getByRole("button", { name: /Edit/ });
    expect(await logAgain.getAttribute("aria-label")).toMatch(/^Log again/);
    expect(await edit.getAttribute("aria-label")).toMatch(/^Edit/);

    const before = (await entriesForUser(user.id)).length;
    await logAgain.click();
    await expect(page.getByText(/Logged .QA8d Tip One. again/)).toBeVisible();
    expect((await entriesForUser(user.id)).length).toBe(before + 1);
  });
});

test.describe("Phase8d QA: touch device (no hover, coarse pointer)", () => {
  // `hasTouch` alone already yields (pointer: coarse) + (hover: none) -- verified directly. Chromium
  // `isMobile` emulation is deliberately NOT used: it rescales the layout viewport, which makes
  // Playwright's own hit-testing mis-locate in-view controls (an emulation artifact, not an app bug).
  test.use({ hasTouch: true, viewport: { width: 390, height: 844 }, timezoneId: "UTC" });

  let user: TestUser;
  let client: SupabaseClient;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    client = await createUserClient(user);
    await logIn(page, user);
    await seedEntries(client, user, [
      { name: "QA8d Touch One", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: todayAt("08:00") },
    ]);
    await page.goto("/food");
    await awaitDayView(page);
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  // SUPERSEDED 2026-08-07 (Phase 8g): this row previously asserted the VISIBLE labels still
  // carried the meaning on touch, with no tooltip. Jeff reviewed exactly that touch-explainability
  // tradeoff (the reason icon+label was chosen in the first place) and confirmed he still wants
  // the label gone everywhere, touch included -- so on touch the button's name now lives ONLY in
  // aria-label (assistive tech), not in anything a sighted touch user can see beyond the icon
  // itself. That is an accepted, deliberate tradeoff (ai-context/DECISIONS.md's "Icons replace
  // buttons+text entirely..."), not a regression to silently paper over -- rewritten per design
  // doc §8 Phase 8g to assert the new, honest reality rather than deleted or left red.
  test("NO tooltip fires on touch, and nothing depends on one: both actions stay NAMED (aria-label) and usable", async ({ page }) => {
    // Sanity check so the assertion below cannot pass vacuously: this really is a
    // no-hover/coarse-pointer context.
    const caps = await page.evaluate(() => ({
      fine: matchMedia("(pointer: fine)").matches,
      hover: matchMedia("(hover: hover)").matches,
    }));
    expect(caps.fine && caps.hover).toBe(false);

    const r = row(page, "QA8d Touch One");
    const button = r.getByRole("button", { name: "Log again" });
    const describedBy = await button.getAttribute("aria-describedby");
    const tip = page.locator('[id="' + describedBy + '"]');

    // The observable consequence, not the media query itself.
    await button.dispatchEvent("mouseenter");
    await button.focus();
    await page.waitForTimeout(700);
    await expect(tip).toBeHidden();

    // The buttons carry no visible text at all now, but ARE still named via aria-label...
    expect(await button.getAttribute("aria-label")).toMatch(/^Log again/);
    expect(await r.getByRole("button", { name: /Edit/ }).getAttribute("aria-label")).toMatch(/^Edit/);

    // ...and the action still works by tap.
    const before = (await entriesForUser(user.id)).length;
    await button.tap();
    await expect(page.getByText(/Logged .QA8d Touch One. again/)).toBeVisible();
    expect((await entriesForUser(user.id)).length).toBe(before + 1);
  });
});

// ---------------------------------------------------------------------------------------------
// The folded-in SSR/client timezone hydration fix
// ---------------------------------------------------------------------------------------------

test.describe("Phase8d QA: FoodDayView SSR/client timezone hydration fix", () => {
  // A zone whose CALENDAR DATE differs from this machine's server tz for most of the UTC day, so
  // a pre-fix render (which computed `today` during SSR from the SERVER's own tz) would disagree
  // with the browser's -- deterministic, not dependent on the wall clock landing in a window.
  test.use({ timezoneId: "Pacific/Auckland" });

  let user: TestUser;

  test.beforeEach(async () => {
    user = await createConfirmedTestUser();
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("STRUCTURAL: the SERVER-rendered /food HTML carries the placeholder and NO timezone-derived date markup", async ({ page }) => {
    await logIn(page, user);
    const res = await page.request.get("/food");
    expect(res.status()).toBe(200);
    const html = await res.text();
    // Pre-fix, the server pass emitted the day input with a tz-derived max/value; there is now
    // nothing tz-dependent for server and client to disagree about on first paint.
    expect(html).not.toContain('id="food-day"');
    expect(html).toContain("Loading");
  });

  test("loading /food in a browser whose timezone differs from the server's produces ZERO hydration-mismatch console errors, and the day shown is the BROWSER's", async ({ page }) => {
    const messages: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") messages.push(m.text());
    });
    page.on("pageerror", (e) => messages.push(String(e)));

    await logIn(page, user);
    await page.goto("/food");
    await expect(page.locator("#food-day")).toBeVisible({ timeout: 20000 });
    await page.waitForTimeout(2000);

    const hydration = messages.filter((m) => /hydrat|did not match|server rendered HTML|server HTML/i.test(m));
    expect(hydration, hydration.join("\n")).toEqual([]);

    const browserToday = await page.evaluate(() =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date()),
    );
    await expect(page.locator("#food-day")).toHaveValue(browserToday);
    await expect(page.locator("#food-day")).toHaveAttribute("max", browserToday);
  });

  test("/metrics keeps the same property (its own pre-existing mount-only-Effect pattern is not disturbed)", async ({ page }) => {
    await logIn(page, user);
    const res = await page.request.get("/metrics");
    const html = await res.text();
    expect(html).not.toContain('id="metric-day"');
    await page.goto("/metrics");
    await expect(page.locator("#metric-day")).toBeVisible({ timeout: 20000 });
    const browserToday = await page.evaluate(() =>
      new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Auckland" }).format(new Date()),
    );
    await expect(page.locator("#metric-day")).toHaveValue(browserToday);
  });
});

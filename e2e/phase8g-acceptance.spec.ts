import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";
import { createAdminClient } from "./helpers/admin-client";
import type { FoodEntry } from "../src/lib/types";

/**
 * QA-REVIEWER independent Phase 8g acceptance suite -- "Delete back on the entry row, icon-only row
 * actions, and a louder editing highlight".
 *
 * Written from docs/architecture/food-weight-tracker.md 3.4 (the two Phase 8g blocks), 6's "Row
 * delete, icon-only actions, and the stronger editing highlight" rows, and 8's Phase 8g section --
 * NOT from the developer's implementation or their own FoodEntryList.test.tsx, which were read only
 * afterwards to look for gaps.
 *
 * PALETTE NOTE: Phase 8g shipped 2026-08-07 against the sage/clay palette, and its own PROGRESS
 * entry describes a "sage-deep ring" and a "bg-sage-deep text-paper" pill. Phase 8i (2026-08-09/10)
 * later swapped the whole token set, and its own 3.4 mapping table states the level-1+ editing row
 * becomes "bar + ring-accent + bg-accent/text-white". So the CURRENT correct colour is --accent
 * (#1D4ED8) on white; asserting sage here would be pinning a superseded spec.
 *
 * The browser is pinned to UTC and every fixture is seeded on TODAY at a fixed quarter-hour,
 * sidestepping both documented pre-existing flakes (the FoodDayView Day-input navigation race and
 * the phase7b pastInstant UTC-midnight fixture collision).
 */

test.use({ timezoneId: "UTC" });

const ACCENT = "rgb(29, 78, 216)"; // --accent #1D4ED8, per 3.4's Phase 8i token table
const ACCENT_RGB_FRAGMENT = "29, 78, 216";
const WHITE = "rgb(255, 255, 255)";

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
  await expect(page.getByRole("button", { name: "Log a saved meal" })).toBeVisible({ timeout: 15000 });
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function todayAt(time: string): string {
  return todayUtc() + "T" + time + ":00.000Z";
}

async function seedEntry(
  name: string,
  consumedAt: string,
  extra: { quantity?: number; unit?: string | null; loggedFromMealId?: string | null } = {},
): Promise<FoodEntry> {
  const { data, error } = await client
    .from("food_entries")
    .insert({
      user_id: user.id,
      name,
      quantity: extra.quantity ?? 1,
      unit: extra.unit ?? null,
      calories_per_unit: 100,
      protein_g_per_unit: 10,
      consumed_at: consumedAt,
      consumed_tz: "UTC",
      logged_from_meal_id: extra.loggedFromMealId ?? null,
    })
    .select()
    .single();
  if (error || !data) throw new Error("seedEntry failed: " + (error ? error.message : "no data"));
  return data as FoodEntry;
}

async function clearEntries() {
  await client.from("food_entries").delete().eq("user_id", user.id);
  await client.from("meals").delete().eq("user_id", user.id);
}

async function dbEntryCount(name: string): Promise<number> {
  const { data, error } = await admin
    .from("food_entries")
    .select("id")
    .eq("user_id", user.id)
    .eq("name", name);
  if (error) throw new Error("dbEntryCount failed: " + error.message);
  return (data ?? []).length;
}

function row(page: Page, name: string) {
  return page.locator("li").filter({ hasText: name });
}

function editForm(page: Page) {
  return page.locator("form").filter({ has: page.getByRole("button", { name: "Save changes" }) });
}

test.describe("Phase 8g -- the reversal: delete is on the row and gone from the form", () => {
  test.beforeEach(async () => {
    await clearEntries();
  });

  test("BOTH halves: the row exposes a Delete control AND the edit form exposes none", async ({ page }) => {
    await seedEntry("Rice bowl", todayAt("12:30"));
    await logIn(page);

    await expect(page.getByRole("button", { name: "Delete Rice bowl", exact: true })).toBeVisible();

    // A one-sided test passes an implementation that adds the row icon and forgets to remove the
    // form button, shipping two delete paths -- which is why 6 requires both halves together.
    await page.getByRole("button", { name: "Edit Rice bowl", exact: true }).click();
    const form = editForm(page);
    await expect(form).toBeVisible();
    await expect(form.getByRole("button", { name: /delete/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Delete entry", exact: true })).toHaveCount(0);
  });

  test("accepting the confirm deletes the row, the DB row, and decrements the day totals", async ({ page }) => {
    await seedEntry("Rice bowl", todayAt("12:30"));
    await seedEntry("Toast", todayAt("12:30"));
    await logIn(page);

    await expect(page.getByText("200 kcal").first()).toBeVisible();
    expect(await dbEntryCount("Rice bowl")).toBe(1);

    let promptMessage = "";
    page.once("dialog", (dialog) => {
      promptMessage = dialog.message();
      void dialog.accept();
    });
    await page.getByRole("button", { name: "Delete Rice bowl", exact: true }).click();

    await expect(row(page, "Rice bowl")).toHaveCount(0);
    expect(promptMessage).toContain("Rice bowl");
    expect(promptMessage).toMatch(/undone/i);
    // Proven by a service-role read, not by the row disappearing from the DOM.
    expect(await dbEntryCount("Rice bowl")).toBe(0);
    await expect(page.getByText("100 kcal").first()).toBeVisible();
  });

  test("THE SAFETY ROW: dismissing the confirm deletes nothing, in the UI and in the DB", async ({ page }) => {
    await seedEntry("Rice bowl", todayAt("12:30"));
    await logIn(page);

    page.once("dialog", (dialog) => void dialog.dismiss());
    await page.getByRole("button", { name: "Delete Rice bowl", exact: true }).click();

    await page.waitForTimeout(1500);
    await expect(row(page, "Rice bowl")).toHaveCount(1);
    expect(await dbEntryCount("Rice bowl")).toBe(1);
  });

  test("a failed delete surfaces a friendly error, no raw Postgres text, and changes nothing", async ({
    page,
    context,
  }) => {
    await seedEntry("Rice bowl", todayAt("12:30"));
    await logIn(page);

    // Reachable, real failure path: drop the session cookies so the Server Action's own getUser()
    // returns null and deleteFoodEntry returns { ok:false, error:"unauthenticated" }. This is
    // Phase 8d's qa N-4 fix, which 8g's spec requires be kept verbatim.
    await context.clearCookies();

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Delete Rice bowl", exact: true }).click();

    await expect(page.getByText(/signed out/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/violates|permission denied|syntax error/i)).toHaveCount(0);
    expect(await dbEntryCount("Rice bowl")).toBe(1);
  });
});

test.describe("Phase 8g -- three icon-only row actions", () => {
  test.beforeEach(async () => {
    await clearEntries();
  });

  test("all three render NO visible text, are real buttons, with verb-first entry-naming labels", async ({
    page,
  }) => {
    await seedEntry("Rice bowl", todayAt("12:30"), { quantity: 2, unit: "cup" });
    await logIn(page);

    // entryDisplayLabel renders "2 cup — Rice bowl", so the accessible names must use it too.
    const expected = [
      "Log again 2 cup — Rice bowl",
      "Edit 2 cup — Rice bowl",
      "Delete 2 cup — Rice bowl",
    ];
    for (const name of expected) {
      const btn = page.getByRole("button", { name, exact: true });
      await expect(btn).toBeVisible();
      expect((await btn.evaluate((el) => el.tagName)).toLowerCase()).toBe("button");
      // Icon-only: the button's own rendered text is empty (the glyph is an aria-hidden svg).
      expect((await btn.innerText()).trim()).toBe("");
    }

    // Each name starts with the unparaphrased verb, so voice control's "click Delete" resolves.
    expect(expected[0].startsWith("Log again ")).toBe(true);
    expect(expected[1].startsWith("Edit ")).toBe(true);
    expect(expected[2].startsWith("Delete ")).toBe(true);
  });

  test("the labels genuinely disambiguate across many rows", async ({ page }) => {
    await seedEntry("Rice bowl", todayAt("12:30"));
    await seedEntry("Toast", todayAt("12:30"));
    await seedEntry("Yoghurt", todayAt("12:30"));
    await logIn(page);

    for (const name of ["Rice bowl", "Toast", "Yoghurt"]) {
      await expect(page.getByRole("button", { name: "Delete " + name, exact: true })).toHaveCount(1);
    }
    const svgCount = await page
      .getByRole("button", { name: "Delete Toast", exact: true })
      .locator('svg[aria-hidden="true"]')
      .count();
    expect(svgCount).toBe(1);
  });

  test("each still carries a supplementary pointer-only tooltip via aria-describedby", async ({ page }) => {
    await seedEntry("Rice bowl", todayAt("12:30"));
    await logIn(page);

    const cases: Array<[string, RegExp]> = [
      ["Log again Rice bowl", /log this entry again/i],
      ["Edit Rice bowl", /edit this entry/i],
      ["Delete Rice bowl", /undone/i],
    ];
    for (const [name, expectedText] of cases) {
      const btn = page.getByRole("button", { name, exact: true });
      const describedBy = await btn.getAttribute("aria-describedby");
      expect(describedBy, name + " should have aria-describedby").toBeTruthy();
      const tip = page.locator("#" + describedBy);
      await expect(tip).toHaveAttribute("role", "tooltip");
      await expect(tip).toHaveText(expectedText);
      // The tooltip explains; the aria-label names. They must not be the same string.
      expect(await btn.getAttribute("aria-label")).toBe(name);
    }
  });
});

test.describe("Phase 8g -- suppression now covers three actions", () => {
  test.beforeEach(async () => {
    await clearEntries();
  });

  test("the edited row hides ALL THREE actions, including the newcomer Delete", async ({ page }) => {
    await seedEntry("Rice bowl", todayAt("12:30"));
    await seedEntry("Toast", todayAt("12:30"));
    await logIn(page);

    await page.getByRole("button", { name: "Edit Rice bowl", exact: true }).click();

    for (const verb of ["Log again", "Edit", "Delete"]) {
      await expect(page.getByRole("button", { name: verb + " Rice bowl", exact: true })).toHaveCount(0);
    }
    // The untouched sibling row keeps all three -- suppression is per-row, not global.
    for (const verb of ["Log again", "Edit", "Delete"]) {
      await expect(page.getByRole("button", { name: verb + " Toast", exact: true })).toHaveCount(1);
    }
  });

  test("a mid-edit row has NO delete path at all, and cancelling restores the row's delete", async ({
    page,
  }) => {
    await seedEntry("Rice bowl", todayAt("12:30"));
    await logIn(page);

    await page.getByRole("button", { name: "Edit Rice bowl", exact: true }).click();
    await expect(page.getByRole("button", { name: "Delete Rice bowl", exact: true })).toHaveCount(0);
    // Nowhere else on the page either. This is the deliberate "Cancel -> trash" design (3.4).
    await expect(page.getByRole("button", { name: /delete/i })).toHaveCount(0);

    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(page.getByRole("button", { name: "Delete Rice bowl", exact: true })).toBeVisible();
  });

  test("select mode hides all three actions and shows a checkbox instead", async ({ page }) => {
    await seedEntry("Rice bowl", todayAt("12:30"));
    await logIn(page);

    await page.getByRole("button", { name: "Select entries", exact: true }).click();
    for (const verb of ["Log again", "Edit", "Delete"]) {
      await expect(page.getByRole("button", { name: verb + " Rice bowl", exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("checkbox", { name: "Select Rice bowl", exact: true })).toBeVisible();
  });

  test("an active group expander hides all three actions on its own rows", async ({ page }) => {
    await seedEntry("Rice bowl", todayAt("12:30"));
    await logIn(page);

    await page.getByRole("button", { name: "Copy this group", exact: true }).click();
    await expect(page.getByRole("region", { name: "Copy this group", exact: true })).toBeVisible();
    for (const verb of ["Log again", "Edit", "Delete"]) {
      await expect(page.getByRole("button", { name: verb + " Rice bowl", exact: true })).toHaveCount(0);
    }
  });

  test("deleting an UNRELATED row leaves an open edit form open (it isn't that entry)", async ({ page }) => {
    await seedEntry("Rice bowl", todayAt("12:30"));
    await seedEntry("Toast", todayAt("12:30"));
    await logIn(page);

    await page.getByRole("button", { name: "Edit Rice bowl", exact: true }).click();
    const form = editForm(page);
    await expect(form).toBeVisible();

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Delete Toast", exact: true }).click();
    await expect(row(page, "Toast")).toHaveCount(0);
    // handleDelete only clears editingEntry when the deleted row IS the edited one.
    await expect(form).toBeVisible();
    await expect(row(page, "Rice bowl").getByText("Editing", { exact: true })).toBeVisible();
  });
});

/**
 * Normalizes ANY CSS colour string to "r,g,b,a" by actually painting it, because Tailwind v4
 * serializes some computed colours as `oklab(...)` and others as `rgb(...)` for the SAME token --
 * so a raw string comparison would report a false mismatch between two identical colours. Painting
 * and reading the pixel back is representation-independent.
 */
async function normalized(page: Page, color: string): Promise<string> {
  const result = await page.evaluate((c: string) => {
    const cv = document.createElement("canvas");
    cv.width = 1;
    cv.height = 1;
    const ctx = cv.getContext("2d");
    if (!ctx) return "";
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return d[0] + "," + d[1] + "," + d[2] + "," + d[3];
  }, color);
  // Self-check: an earlier draft of this helper silently returned `undefined`, which made every
  // `.toBe()` comparison between two normalized colours pass VACUOUSLY (undefined === undefined).
  // Assert the shape, so this suite can never regress into asserting nothing.
  expect(result, "normalized() must return r,g,b,a for " + color).toMatch(/^\d+,\d+,\d+,\d+$/);
  return result;
}

/**
 * Row <li>s carry `transition-colors`, so a computed colour sampled immediately after a click is a
 * mid-transition BLEND (observed: an accent border read back as 201,218,246 rather than
 * 29,78,216). Every colour assertion below therefore polls until the value settles, and the mouse
 * is parked away from the list so `hover:bg-slate-50/70` can't contaminate a background reading.
 */
async function settledColor(
  page: Page,
  locator: ReturnType<Page["locator"]>,
  prop: "backgroundColor" | "borderLeftColor" | "color",
): Promise<string> {
  let last = "";
  await expect
    .poll(
      async () => {
        const raw = await locator.evaluate(
          (el, p) => getComputedStyle(el)[p as "backgroundColor"],
          prop,
        );
        const now = await normalized(page, raw);
        const stable = now === last;
        last = now;
        return stable ? now : "unsettled:" + now;
      },
      { timeout: 5000, intervals: [200, 200, 200, 200, 200] },
    )
    .not.toContain("unsettled");
  return last;
}

async function parkMouse(page: Page) {
  await page.mouse.move(0, 0);
}

test.describe("Phase 8g -- the louder editing highlight, without collateral damage", () => {
  test.beforeEach(async () => {
    await clearEntries();
  });

  test("computed ring + filled pill are present, and the row's own background is unchanged", async ({
    page,
  }) => {
    await seedEntry("Rice bowl", todayAt("12:30"));
    await seedEntry("Toast", todayAt("12:30"));
    await logIn(page);
    await parkMouse(page);

    const target = row(page, "Rice bowl");
    const sibling = row(page, "Toast");
    const bgBefore = await settledColor(page, target, "backgroundColor");

    await page.getByRole("button", { name: "Edit Rice bowl", exact: true }).click();
    await parkMouse(page);

    // The FILLED pill (level 1+, not 8b's bare caption): accent fill, white text.
    const pill = target.getByText("Editing", { exact: true });
    await expect(pill).toBeVisible();
    expect(await settledColor(page, pill, "backgroundColor")).toBe(await normalized(page, ACCENT));
    expect(await settledColor(page, pill, "color")).toBe(await normalized(page, WHITE));
    // 8i's rule: status pills stay fully round.
    const pillRadius = await pill.evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
    expect(parseFloat(pillRadius)).toBeGreaterThanOrEqual(500);

    // The inset ring, asserted on COMPUTED style (a class name in source proves nothing if the
    // utility was never generated) -- the visual-identity suite's own method.
    const shadow = await target.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow).toContain("inset");
    expect(shadow).toContain(ACCENT_RGB_FRAGMENT);
    // The accent BAR survives alongside the ring.
    expect(await settledColor(page, target, "borderLeftColor")).toBe(await normalized(page, ACCENT));
    // SURFACE UNCHANGED -- the explicit "no fill" constraint (3.4).
    expect(await settledColor(page, target, "backgroundColor")).toBe(bgBefore);

    const siblingShadow = await sibling.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(siblingShadow).not.toContain(ACCENT_RGB_FRAGMENT);
  });

  test("a From-a-saved-meal badge in the edited row stays visible and distinguishable", async ({
    page,
  }) => {
    const { data: meal, error } = await client
      .from("meals")
      .insert({ user_id: user.id, name: "QA8g Source" })
      .select()
      .single();
    if (error || !meal) throw new Error("seed meal failed");
    await seedEntry("Rice bowl", todayAt("12:30"), { loggedFromMealId: meal.id });
    await logIn(page);
    await parkMouse(page);

    const target = row(page, "Rice bowl");
    await expect(target.getByText("From a saved meal")).toBeVisible();

    await page.getByRole("button", { name: "Edit Rice bowl", exact: true }).click();
    await parkMouse(page);

    const badge = target.getByText("From a saved meal");
    await expect(badge).toBeVisible();
    const badgeBg = await settledColor(page, badge, "backgroundColor");
    const pillBg = await settledColor(
      page,
      target.getByText("Editing", { exact: true }),
      "backgroundColor",
    );
    // The whole reason a row fill was rejected: the two chips must stay tellable apart.
    expect(badgeBg).not.toBe(pillBg);
  });

  test("select mode and editing coexist; a merely-checked row gets no visual state of its own", async ({
    page,
  }) => {
    await seedEntry("Rice bowl", todayAt("12:30"));
    await seedEntry("Toast", todayAt("12:30"));
    await logIn(page);
    await parkMouse(page);

    await page.getByRole("button", { name: "Edit Rice bowl", exact: true }).click();
    await page.getByRole("button", { name: "Select entries", exact: true }).click();
    await parkMouse(page);

    // Entering select mode must NOT cancel the in-progress edit (it would discard typed changes).
    await expect(editForm(page)).toBeVisible();

    const edited = row(page, "Rice bowl");
    await expect(edited.getByText("Editing", { exact: true })).toBeVisible();

    const editedBox = page.getByRole("checkbox", { name: "Select Rice bowl", exact: true });
    await editedBox.check();
    await parkMouse(page);
    await expect(editedBox).toBeChecked();
    // A row can legitimately be checked AND ringed at once.
    await expect(edited.getByText("Editing", { exact: true })).toBeVisible();

    // A merely-checked row (not edited) gets no ring and no background state of its own.
    const plain = row(page, "Toast");
    const before = await settledColor(page, plain, "backgroundColor");
    await page.getByRole("checkbox", { name: "Select Toast", exact: true }).check();
    await parkMouse(page);
    expect(await settledColor(page, plain, "backgroundColor")).toBe(before);
    const plainShadow = await plain.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(plainShadow).not.toContain(ACCENT_RGB_FRAGMENT);
  });
});

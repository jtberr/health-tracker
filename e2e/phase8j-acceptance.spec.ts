import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";
import { createAdminClient } from "./helpers/admin-client";

/**
 * QA-REVIEWER independent Phase 8j acceptance suite -- "Daily calorie/protein goal progress on
 * /food".
 *
 * Written from docs/architecture/food-weight-tracker.md 3.4's "Daily goal progress on /food"
 * block, 6's "Daily goal progress" rows and 8's Phase 8j section -- NOT from the implementation.
 *
 * The two rows 6 says to hammer: (1) the no-goal fallback is byte-for-byte today's behaviour --
 * asserted as an ABSENCE, since a 0%-width bar or a "0 of 0" caption passes a presence-only check
 * and looks broken; and (2) over target keeps the caption truthful while clamping only the bar.
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
  await expect(page).toHaveURL("/food", { timeout: 15000 });
  await expect(page.getByRole("button", { name: "Log a saved meal" })).toBeVisible({ timeout: 15000 });
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

async function setGoals(calories: number | null, protein: number | null) {
  const { error } = await client.from("user_goals").upsert(
    { user_id: user.id, daily_calorie_target: calories, daily_protein_target_g: protein },
    { onConflict: "user_id" },
  );
  if (error) throw new Error("setGoals failed: " + error.message);
}

async function seedEntry(name: string, calories: number, protein: number, date = todayUtc()) {
  const { error } = await client.from("food_entries").insert({
    user_id: user.id,
    name,
    quantity: 1,
    unit: null,
    calories_per_unit: calories,
    protein_g_per_unit: protein,
    consumed_at: date + "T12:30:00.000Z",
    consumed_tz: "UTC",
  });
  if (error) throw new Error("seedEntry failed: " + error.message);
}

async function clearAll() {
  await client.from("food_entries").delete().eq("user_id", user.id);
  await client.from("user_goals").delete().eq("user_id", user.id);
}

/** The stat card whose label matches -- Calories / Protein / % from protein. */
function statCard(page: Page, label: string) {
  return page
    .locator("div")
    .filter({ has: page.getByText(label, { exact: true }) })
    .last();
}

/** A progress bar inside a card: the aria-hidden track with a width-styled fill. */
function barIn(card: ReturnType<typeof statCard>) {
  return card.locator('div[aria-hidden="true"]');
}

test.describe("Phase 8j -- ROW 1: the no-goal fallback is byte-for-byte today's behaviour", () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test("with NO targets, both cards show the number and NOTHING else -- no bar, no caption", async ({
    page,
  }) => {
    await setGoals(null, null);
    await seedEntry("QA8j Rice", 400, 20);
    await logIn(page);

    const cal = statCard(page, "Calories");
    const prot = statCard(page, "Protein");
    await expect(cal.getByText("400", { exact: true })).toBeVisible();
    await expect(prot.getByText("20g", { exact: true })).toBeVisible();

    // Asserted as ABSENCES -- a 0%-width bar or a "0 of 0" caption would pass a presence-only test.
    await expect(barIn(cal)).toHaveCount(0);
    await expect(barIn(prot)).toHaveCount(0);
    await expect(page.getByText(/remaining/i)).toHaveCount(0);
    await expect(page.getByText(/ over$/i)).toHaveCount(0);
    await expect(page.getByText(/ of /)).toHaveCount(0);
  });

  test("the 'Set daily targets' link appears exactly ONCE when both are unset", async ({ page }) => {
    await setGoals(null, null);
    await logIn(page);
    const link = page.getByRole("link", { name: "Set daily targets", exact: true });
    await expect(link).toHaveCount(1);
    await expect(link).toHaveAttribute("href", "/settings");
  });

  test("...and is ABSENT the moment either one is set", async ({ page }) => {
    await setGoals(2000, null);
    await logIn(page);
    await expect(page.getByRole("link", { name: "Set daily targets", exact: true })).toHaveCount(0);

    await setGoals(null, 150);
    await page.reload();
    await expect(page.getByRole("button", { name: "Log a saved meal" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("link", { name: "Set daily targets", exact: true })).toHaveCount(0);
  });

  test("PARTIAL GOALS ARE INDEPENDENT: a calorie-only target leaves the protein card untouched", async ({
    page,
  }) => {
    await setGoals(2000, null);
    await seedEntry("QA8j Rice", 400, 20);
    await logIn(page);

    const cal = statCard(page, "Calories");
    const prot = statCard(page, "Protein");
    // Calories gains a bar + caption...
    await expect(barIn(cal)).toHaveCount(1);
    await expect(cal.getByText("400 of 2,000 · 1,600 remaining")).toBeVisible();
    // ...protein gains neither. An implementation gating both cards on one flag ships broken.
    await expect(barIn(prot)).toHaveCount(0);
    await expect(prot.getByText(/remaining|of /)).toHaveCount(0);
  });

  test("the % from protein card NEVER gains a bar or a caption", async ({ page }) => {
    await setGoals(2000, 150);
    await seedEntry("QA8j Rice", 400, 20);
    await logIn(page);

    const pctCard = statCard(page, "% from protein");
    await expect(barIn(pctCard)).toHaveCount(0);
    await expect(pctCard.getByText(/remaining|of /)).toHaveCount(0);
  });
});

test.describe("Phase 8j -- ROW 2: over target tells the truth while only the bar clamps", () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test("the caption says 'over' with the right magnitude and the bar is EXACTLY 100% wide", async ({
    page,
  }) => {
    await setGoals(2000, 150);
    await seedEntry("QA8j Feast", 2800, 100);
    await logIn(page);

    const cal = statCard(page, "Calories");
    await expect(cal.getByText("2,800 of 2,000 · 800 over")).toBeVisible();
    // ...and NOT phrased as a negative remaining.
    await expect(cal.getByText(/-800 remaining/)).toHaveCount(0);

    const fill = barIn(cal).locator("div").first();
    const width = await fill.evaluate((el) => (el as HTMLElement).style.width);
    expect(width).toBe("100%");
  });

  test("the over-target bar is NOT red -- it stays the calorie accent", async ({ page }) => {
    await setGoals(2000, null);
    await seedEntry("QA8j Feast", 2800, 100);
    await logIn(page);

    const fill = barIn(statCard(page, "Calories")).locator("div").first();
    const color = await fill.evaluate((el) => getComputedStyle(el).backgroundColor);
    const rgb = await page.evaluate((c: string) => {
      const cv = document.createElement("canvas");
      cv.width = 1;
      cv.height = 1;
      const ctx = cv.getContext("2d")!;
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return d[0] + "," + d[1] + "," + d[2];
    }, color);
    // --accent-warm #C2410C, deliberately not a semantic red.
    expect(rgb).toBe("194,65,12");
  });

  test("ACCESSIBILITY: the bar is aria-hidden with no progressbar role and no aria-valuenow", async ({
    page,
  }) => {
    await setGoals(2000, 150);
    await seedEntry("QA8j Rice", 400, 20);
    await logIn(page);

    await expect(page.getByRole("progressbar")).toHaveCount(0);
    const bars = page.locator('div[aria-hidden="true"]').filter({ has: page.locator("div") });
    expect(await bars.count()).toBeGreaterThan(0);
    for (let i = 0; i < (await bars.count()); i++) {
      expect(await bars.nth(i).getAttribute("aria-valuenow")).toBeNull();
      expect(await bars.nth(i).getAttribute("role")).toBeNull();
    }
    // The over/under state is carried by the WORD, not by colour alone (WCAG 1.4.1).
    await expect(statCard(page, "Calories").getByText(/remaining/)).toBeVisible();
  });
});

test.describe("Phase 8j -- the numbers come from the view, and nothing is stored", () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  test("the caption's consumed figure equals daily_food_totals, and remaining = target - consumed", async ({
    page,
  }) => {
    await setGoals(2000, 150);
    await seedEntry("QA8j A", 430, 21);
    await seedEntry("QA8j B", 275, 13);
    await logIn(page);

    const { data } = await admin
      .from("daily_food_totals")
      .select("total_calories, total_protein_g")
      .eq("user_id", user.id)
      .eq("consumed_local_date", todayUtc())
      .single();
    const cals = Number(data!.total_calories);
    const prot = Number(data!.total_protein_g);
    expect(cals).toBe(705);

    await expect(
      statCard(page, "Calories").getByText(
        cals.toLocaleString() + " of 2,000 · " + (2000 - cals).toLocaleString() + " remaining",
      ),
    ).toBeVisible();
    await expect(
      statCard(page, "Protein").getByText(
        prot.toLocaleString() + " of 150 · " + (150 - prot).toLocaleString() + " remaining",
      ),
    ).toBeVisible();
  });

  test("adding an entry updates the bar and caption WITHOUT a reload", async ({ page }) => {
    await setGoals(2000, 150);
    await seedEntry("QA8j A", 400, 20);
    await logIn(page);
    await expect(statCard(page, "Calories").getByText("400 of 2,000 · 1,600 remaining")).toBeVisible();

    await page.getByLabel("Name", { exact: true }).fill("QA8j Added");
    await page.getByLabel("Total calories", { exact: true }).fill("600");
    await page.getByLabel("Total protein (g)", { exact: true }).fill("30");
    await page.getByRole("button", { name: "Add entry", exact: true }).click();

    await expect(statCard(page, "Calories").getByText("1,000 of 2,000 · 1,000 remaining")).toBeVisible({
      timeout: 15000,
    });
  });

  test("NOTHING IS STORED: user_goals is unchanged (updated_at included) by viewing /food", async ({
    page,
  }) => {
    await setGoals(2000, 150);
    const { data: before } = await admin
      .from("user_goals")
      .select("*")
      .eq("user_id", user.id)
      .single();

    await logIn(page);
    await expect(statCard(page, "Calories").getByText(/of 2,000/)).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: "Log a saved meal" })).toBeVisible({ timeout: 15000 });

    const { data: after } = await admin.from("user_goals").select("*").eq("user_id", user.id).single();
    // Full-row equality: no percentage, no remaining, no "progress" column, and no stray write.
    expect(after).toEqual(before);
    // ...and there is exactly ONE goals row -- the ensure-row upsert stayed idempotent.
    const { data: rows } = await admin.from("user_goals").select("user_id").eq("user_id", user.id);
    expect(rows ?? []).toHaveLength(1);
  });

  test("goals survive a day change and are NOT refetched per day, while totals track the day", async ({
    page,
  }) => {
    await setGoals(2000, 150);
    await seedEntry("QA8j Today", 400, 20);
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await seedEntry("QA8j Yesterday", 900, 45, yesterday);
    await logIn(page);
    await expect(statCard(page, "Calories").getByText("400 of 2,000 · 1,600 remaining")).toBeVisible();

    // Browse back a day through the DayNavigator (deliberately not the flaky Day input).
    await page.getByRole("button", { name: "Previous day" }).click();

    // The totals change...
    await expect(statCard(page, "Calories").getByText("900 of 2,000 · 1,100 remaining")).toBeVisible({
      timeout: 15000,
    });
    // ...and the TARGET does not: a past day renders against today's target, per the recorded
    // "single current goal, not goal history" decision.
  });

  test("CROSS-USER: user B's /food never shows user A's targets", async ({ browser }) => {
    await setGoals(2000, 150);
    await seedEntry("QA8j A", 400, 20);

    const other = await createConfirmedTestUser();
    try {
      const ctx = await browser.newContext({ timezoneId: "UTC" });
      const p2 = await ctx.newPage();
      await p2.goto("/login");
      await p2.getByLabel("Email").fill(other.email);
      await p2.getByLabel("Password").fill(other.password);
      await p2.getByRole("button", { name: "Log in" }).click();
      await expect(p2).toHaveURL("/food", { timeout: 15000 });
      await expect(p2.getByRole("button", { name: "Log a saved meal" })).toBeVisible({ timeout: 15000 });

      // No target text of A's anywhere, and B gets the first-run "Set daily targets" link instead.
      await expect(p2.getByText(/of 2,000/)).toHaveCount(0);
      await expect(p2.getByText(/of 150/)).toHaveCount(0);
      await expect(p2.getByRole("link", { name: "Set daily targets", exact: true })).toHaveCount(1);
      await ctx.close();
    } finally {
      await deleteTestUser(other.id);
    }
  });
});

test.describe("Phase 8j -- adversarial: the risks the server-read choice actually carries", () => {
  test.beforeEach(async () => {
    await clearAll();
  });

  /**
   * 3.4 defends the server-side goals read on the grounds that goals "cannot be changed from this
   * screen, so there is nothing here for them to go stale against". The reachable staleness risk it
   * does NOT discuss is the round trip: change a target on /settings, then navigate back to /food
   * via the client router. If the router cache served a stale RSC payload, /food would keep showing
   * the OLD target with no way to notice.
   */
  test("changing a target on /settings and navigating back to /food shows the NEW target", async ({
    page,
  }) => {
    await setGoals(2000, 150);
    await seedEntry("QA8j Rice", 400, 20);
    await logIn(page);
    await expect(statCard(page, "Calories").getByText("400 of 2,000 · 1,600 remaining")).toBeVisible();

    await page.getByRole("link", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 15000 });

    await page.getByLabel(/calorie/i).fill("2500");
    await page.getByRole("button", { name: /save/i }).click();
    await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 15000 });

    // Back to /food through the client router -- the path a real user takes.
    await page.getByRole("link", { name: "Food", exact: true }).click();
    await expect(page.getByRole("button", { name: "Log a saved meal" })).toBeVisible({ timeout: 15000 });

    await expect(statCard(page, "Calories").getByText("400 of 2,500 · 2,100 remaining")).toBeVisible({
      timeout: 15000,
    });
  });

  test("a stored target of 0 degrades to the plain no-goal treatment, not a divide-by-zero", async ({
    page,
  }) => {
    await setGoals(0, 150);
    await seedEntry("QA8j Rice", 400, 20);
    await logIn(page);

    const cal = statCard(page, "Calories");
    await expect(cal.getByText("400", { exact: true })).toBeVisible();
    // No bar, no caption, no Infinity/NaN leaking into the DOM.
    await expect(barIn(cal)).toHaveCount(0);
    await expect(page.getByText(/Infinity|NaN/)).toHaveCount(0);
    // ...while the protein card, which has a real target, is unaffected.
    await expect(barIn(statCard(page, "Protein"))).toHaveCount(1);
    // Both-unset is NOT the state here (protein IS set), so no first-run link.
    await expect(page.getByRole("link", { name: "Set daily targets", exact: true })).toHaveCount(0);
  });
});

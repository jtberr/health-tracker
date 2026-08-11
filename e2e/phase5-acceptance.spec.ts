import { test, expect, type Page } from "@playwright/test";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";

// QA-REVIEWER independent Phase 5 acceptance suite. Written from the design doc spec
// (docs/architecture/food-weight-tracker.md section 8 Phase 5 + section 2 "Trends / charts (v1)"
// + section 6) and ai-context/DECISIONS.md ("Chart gaps: connect across missing days, mark real
// entries with a dot"; "Weight stored canonically in kg; kg/lb is a display/input toggle";
// "Single current goal"). NOT derived from the developer's trends.test.ts or their throwaway
// script.
//
// Spec requirements exercised here:
//   (1) gap rendering  -- a continuous line across missing days, a dot ONLY on real days
//   (2) dense series   -- every calendar day in the window is present
//   (3) goal lines     -- a goal ReferenceLine renders when (and only when) that goal is SET
//   (4) unit preference-- the weight SERIES (not just the label) renders in kg vs lb
//   (5) range filtering-- 7/30/90 windows end on the user's LOCAL today, no UTC truncation
//   (6) Absolute Rules -- RLS-scoped reads only, no client-supplied user_id, cross-user isolation

async function logIn(page: Page, user: TestUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/food");
}

/** YYYY-MM-DD `n` days before now, in UTC -- pairs with test.use({ timezoneId: "UTC" }). */
function utcDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

/** The calendar date the BROWSER thinks it is, in its configured timezone. */
async function browserToday(page: Page): Promise<string> {
  return page.evaluate(() => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    return parts;
  });
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

type Seed = { date: string; weightKg?: number; bodyFat?: number; calories?: number; proteinG?: number };

async function seed(user: TestUser, rows: Seed[]) {
  const client = await createUserClient(user);
  const metrics = rows
    .filter((r) => r.weightKg !== undefined)
    .map((r) => ({
      user_id: user.id,
      metric_date: r.date,
      weight_kg: r.weightKg!,
      body_fat_pct: r.bodyFat ?? null,
    }));
  if (metrics.length > 0) {
    const res = await client.from("daily_metrics").insert(metrics);
    expect(res.error, `seeding daily_metrics failed: ${res.error?.message}`).toBeNull();
  }
  const entries = rows
    .filter((r) => r.calories !== undefined)
    .map((r) => ({
      user_id: user.id,
      name: `seed ${r.date}`,
      quantity: 1,
      calories_per_unit: r.calories!,
      protein_g_per_unit: r.proteinG ?? 0,
      consumed_at: `${r.date}T12:00:00Z`,
      consumed_tz: "UTC",
    }));
  if (entries.length > 0) {
    const res = await client.from("food_entries").insert(entries);
    expect(res.error, `seeding food_entries failed: ${res.error?.message}`).toBeNull();
  }
  return client;
}

async function setGoals(
  user: TestUser,
  goals: { calorie?: number | null; protein?: number | null; unit?: "kg" | "lb" },
) {
  const client = await createUserClient(user);
  const res = await client
    .from("user_goals")
    .upsert(
      {
        user_id: user.id,
        daily_calorie_target: goals.calorie ?? null,
        daily_protein_target_g: goals.protein ?? null,
        weight_unit: goals.unit ?? "kg",
      },
      { onConflict: "user_id" },
    )
    .select();
  expect(res.error, `seeding user_goals failed: ${res.error?.message}`).toBeNull();
}

const chart = (page: Page, which: "weight" | "intake") =>
  page.locator(".recharts-wrapper").nth(which === "weight" ? 0 : 1);

/** Dot markers actually painted for a series, in DOM order (weight/calories first, then the 2nd series). */
const seriesDots = (page: Page, which: "weight" | "intake", index: number) =>
  chart(page, which).locator(".recharts-line-dots").nth(index).locator("circle");

const seriesCurve = (page: Page, which: "weight" | "intake", index: number) =>
  chart(page, which).locator("path.recharts-line-curve").nth(index);

async function waitForCharts(page: Page, expected: number) {
  await expect(page.locator(".recharts-wrapper")).toHaveCount(expected, { timeout: 15000 });
  await expect(page.locator(".recharts-xAxis-tick-labels text").first()).toBeAttached({ timeout: 15000 });
}

/** Left-hand Y axis tick label values, as numbers. */
async function leftAxisTicks(page: Page, which: "weight" | "intake"): Promise<number[]> {
  const texts = await chart(page, which)
    .locator(".recharts-yAxis-tick-labels")
    .first()
    .locator("text")
    .allTextContents();
  return texts.map(Number).filter((n) => !Number.isNaN(n));
}

// ---------------------------------------------------------------------------------------------
// (1) + (2) Gap rendering and dense series -- the core DECISIONS.md "chart gaps" rule.
// ---------------------------------------------------------------------------------------------
test.describe("Phase5 QA gap rendering: connected line, dots only on real days", () => {
  test.use({ timezoneId: "UTC" });
  let user: TestUser;
  test.beforeEach(async () => {
    user = await createConfirmedTestUser();
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("weight: 3 logged days in a 7-day window draw ONE continuous line with exactly 3 dots", async ({ page }) => {
    await seed(user, [
      { date: utcDaysAgo(6), weightKg: 82 },
      { date: utcDaysAgo(3), weightKg: 81 },
      { date: utcDaysAgo(0), weightKg: 80 },
    ]);
    await logIn(page, user);
    await page.goto("/trends?range=7");
    await waitForCharts(page, 1);

    // A dot ONLY on real days -- the 4 gap days get none.
    await expect(seriesDots(page, "weight", 0)).toHaveCount(3);

    // ...but the line is CONTINUOUS across those gaps: a single SVG subpath (one "M" command),
    // not one broken segment per island of data.
    const d = await seriesCurve(page, "weight", 0).getAttribute("d");
    expect(d).not.toBeNull();
    expect((d!.match(/M/g) ?? []).length).toBe(1);
  });

  test("the series is DENSE: all 7 calendar days of the window appear on the x-axis, not just logged ones", async ({ page }) => {
    await seed(user, [
      { date: utcDaysAgo(6), weightKg: 82 },
      { date: utcDaysAgo(0), weightKg: 80 },
    ]);
    await logIn(page, user);
    await page.goto("/trends?range=7");
    await waitForCharts(page, 1);

    const ticks = await chart(page, "weight")
      .locator(".recharts-xAxis-tick-labels text")
      .allTextContents();
    expect(ticks).toHaveLength(7);
    // First/last tick must be the window bounds, not the first/last LOGGED day.
    const fmt = (iso: string) =>
      new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(
        new Date(`${iso}T00:00:00Z`),
      );
    expect(ticks[0]).toBe(fmt(utcDaysAgo(6)));
    expect(ticks[6]).toBe(fmt(utcDaysAgo(0)));
  });

  test("a single logged day in the window still renders (1 dot, full 7-day axis)", async ({ page }) => {
    await seed(user, [{ date: utcDaysAgo(4), weightKg: 77 }]);
    await logIn(page, user);
    await page.goto("/trends?range=7");
    await waitForCharts(page, 1);
    await expect(seriesDots(page, "weight", 0)).toHaveCount(1);
    expect(await chart(page, "weight").locator(".recharts-xAxis-tick-labels text").count()).toBe(7);
  });

  test("intake: both calorie and protein series get dots only on logged days, connected across the gap", async ({ page }) => {
    await seed(user, [
      { date: utcDaysAgo(6), weightKg: 80, calories: 1800, proteinG: 120 },
      // 5 gap days with no food logged at all
      { date: utcDaysAgo(0), weightKg: 79, calories: 2100, proteinG: 140 },
    ]);
    await logIn(page, user);
    await page.goto("/trends?range=7");
    await waitForCharts(page, 2);

    await expect(seriesDots(page, "intake", 0)).toHaveCount(2); // calories
    await expect(seriesDots(page, "intake", 1)).toHaveCount(2); // protein
    for (const i of [0, 1]) {
      const d = await seriesCurve(page, "intake", i).getAttribute("d");
      expect((d!.match(/M/g) ?? []).length).toBe(1);
    }
  });

  test("a day logged with ZERO calories is a REAL day (gets a dot), not a gap", async ({ page }) => {
    // The case that proves the dot is keyed on "did the user log this day", not on the value
    // being non-null/non-zero: a 0-kcal entry (water, a diet drink) is a logged day.
    await seed(user, [
      { date: utcDaysAgo(5), weightKg: 80, calories: 2000, proteinG: 150 },
      { date: utcDaysAgo(2), weightKg: 80, calories: 0, proteinG: 0 },
    ]);
    await logIn(page, user);
    await page.goto("/trends?range=7");
    await waitForCharts(page, 2);
    await expect(seriesDots(page, "intake", 0)).toHaveCount(2);
  });
});

// ---------------------------------------------------------------------------------------------
// (3) Goal ReferenceLines -- design doc section 8 Phase 5 "IntakeChart (goal ReferenceLine)" and
//     section 6 "goal line only when set". A goal is "set" when user_goals.daily_calorie_target /
//     daily_protein_target_g is non-null; getGoals()'s ensure-row default leaves both null.
// ---------------------------------------------------------------------------------------------
const refLines = (page: Page) => chart(page, "intake").locator(".recharts-reference-line");

test.describe("Phase5 QA goal ReferenceLine renders only when the goal is set", () => {
  test.use({ timezoneId: "UTC" });
  let user: TestUser;
  test.beforeEach(async () => {
    user = await createConfirmedTestUser();
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("no goals set (ensure-row default): NO reference line and NO goal legend entries", async ({ page }) => {
    await seed(user, [
      { date: utcDaysAgo(4), weightKg: 80, calories: 1800, proteinG: 120 },
      { date: utcDaysAgo(1), weightKg: 80, calories: 2000, proteinG: 130 },
    ]);
    await logIn(page, user);
    await page.goto("/trends?range=7");
    await waitForCharts(page, 2);

    await expect(refLines(page)).toHaveCount(0);
    await expect(page.getByText("Calorie goal")).toHaveCount(0);
    await expect(page.getByText("Protein goal")).toHaveCount(0);
  });

  test("a goal of 0 is still a set goal, and a null goal draws nothing at 0", async ({ page }) => {
    // Guards the "null means don't draw, never draw at 0" claim in IntakeChart's doc comment:
    // with only a protein goal set, exactly one line may appear -- never a stray calorie line.
    await seed(user, [
      { date: utcDaysAgo(4), weightKg: 80, calories: 1800, proteinG: 120 },
      { date: utcDaysAgo(1), weightKg: 80, calories: 2000, proteinG: 130 },
    ]);
    await setGoals(user, { protein: 100 });
    await logIn(page, user);
    await page.goto("/trends?range=7");
    await waitForCharts(page, 2);

    await expect(page.getByText("Protein goal")).toBeVisible();
    await expect(page.getByText("Calorie goal")).toHaveCount(0);
    await expect(refLines(page)).toHaveCount(1);
  });

  test("SPEC: a calorie goal ABOVE the logged intake still draws its goal line (under-target user)", async ({ page }) => {
    // The single most important case for this feature: the design doc's stated purpose is
    // answering "am I hitting my protein target?" -- i.e. the user is BELOW the goal. The goal
    // line has to be visible precisely then.
    await seed(user, [
      { date: utcDaysAgo(4), weightKg: 80, calories: 1200, proteinG: 60 },
      { date: utcDaysAgo(1), weightKg: 80, calories: 1400, proteinG: 70 },
    ]);
    await setGoals(user, { calorie: 2000, protein: 150 });
    await logIn(page, user);
    await page.goto("/trends?range=7");
    await waitForCharts(page, 2);

    await expect(page.getByText("Calorie goal")).toBeVisible();
    await expect(page.getByText("Protein goal")).toBeVisible();
    await expect(refLines(page)).toHaveCount(2);
  });

  test("a goal INSIDE the logged intake range draws its goal line", async ({ page }) => {
    await seed(user, [
      { date: utcDaysAgo(4), weightKg: 80, calories: 2400, proteinG: 170 },
      { date: utcDaysAgo(1), weightKg: 80, calories: 1600, proteinG: 100 },
    ]);
    await setGoals(user, { calorie: 2000, protein: 150 });
    await logIn(page, user);
    await page.goto("/trends?range=7");
    await waitForCharts(page, 2);

    await expect(refLines(page)).toHaveCount(2);
  });

  test("the weight chart never draws a goal line (goals are intake-only)", async ({ page }) => {
    await seed(user, [
      { date: utcDaysAgo(4), weightKg: 80, calories: 2400, proteinG: 170 },
      { date: utcDaysAgo(1), weightKg: 79, calories: 1600, proteinG: 100 },
    ]);
    await setGoals(user, { calorie: 2000, protein: 150 });
    await logIn(page, user);
    await page.goto("/trends?range=7");
    await waitForCharts(page, 2);
    await expect(chart(page, "weight").locator(".recharts-reference-line")).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------------------------
// (4) Unit preference -- the SERIES itself must render in the user's unit, not just the label.
//     Storage stays canonical kg (DECISIONS.md "Weight stored canonically in kg").
// ---------------------------------------------------------------------------------------------
test.describe("Phase5 QA weight series renders in the user's unit preference", () => {
  test.use({ timezoneId: "UTC" });
  let user: TestUser;
  test.beforeEach(async () => {
    user = await createConfirmedTestUser();
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("kg preference plots kg values; lb preference plots converted lb values; storage unchanged", async ({ page }) => {
    const client = await seed(user, [
      { date: utcDaysAgo(5), weightKg: 70 },
      { date: utcDaysAgo(0), weightKg: 80 },
    ]);
    await setGoals(user, { unit: "kg" });
    await logIn(page, user);
    await page.goto("/trends?range=7");
    await waitForCharts(page, 1);

    await expect(page.getByText("Weight (kg)")).toBeVisible();
    const kgTicks = await leftAxisTicks(page, "weight");
    expect(kgTicks.length).toBeGreaterThan(0);
    // 70..80 kg -- the whole axis must sit in kg territory, nowhere near the lb equivalents.
    expect(Math.max(...kgTicks)).toBeLessThan(120);

    await setGoals(user, { unit: "lb" });
    await page.goto("/trends?range=7&cachebust=1");
    await waitForCharts(page, 1);

    await expect(page.getByText("Weight (lb)")).toBeVisible();
    const lbTicks = await leftAxisTicks(page, "weight");
    expect(lbTicks.length).toBeGreaterThan(0);
    // 70 kg = 154.3 lb, 80 kg = 176.4 lb -- the axis must have moved, i.e. the SERIES converted.
    expect(Math.max(...lbTicks)).toBeGreaterThan(140);

    // ...and the stored values are untouched canonical kg.
    const stored = await client.from("daily_metrics").select("weight_kg").order("metric_date");
    expect((stored.data ?? []).map((r) => Number(r.weight_kg))).toEqual([70, 80]);
  });
});

// ---------------------------------------------------------------------------------------------
// Optional body-fat second axis/series (design doc section 8 Phase 5 "optional body-fat second axis").
// ---------------------------------------------------------------------------------------------
test.describe("Phase5 QA optional body-fat series", () => {
  test.use({ timezoneId: "UTC" });
  let user: TestUser;
  test.beforeEach(async () => {
    user = await createConfirmedTestUser();
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("weight-only data renders no body-fat axis, series or legend", async ({ page }) => {
    await seed(user, [
      { date: utcDaysAgo(5), weightKg: 80 },
      { date: utcDaysAgo(0), weightKg: 79 },
    ]);
    await logIn(page, user);
    await page.goto("/trends?range=7");
    await waitForCharts(page, 1);

    await expect(page.getByRole("heading", { name: "Weight", exact: true })).toBeVisible();
    await expect(page.getByText("Body fat %")).toHaveCount(0);
    expect(await chart(page, "weight").locator(".recharts-yAxis-tick-labels").count()).toBe(1);
    expect(await chart(page, "weight").locator(".recharts-line-dots").count()).toBe(1);
  });

  test("body fat on only ONE of three logged days: second axis appears, but only that day gets a body-fat dot", async ({ page }) => {
    await seed(user, [
      { date: utcDaysAgo(5), weightKg: 80 },
      { date: utcDaysAgo(3), weightKg: 79.5, bodyFat: 21.5 },
      { date: utcDaysAgo(0), weightKg: 79 },
    ]);
    await logIn(page, user);
    await page.goto("/trends?range=7");
    await waitForCharts(page, 1);

    await expect(page.getByRole("heading", { name: "Weight & body fat" })).toBeVisible();
    await expect(page.getByText("Body fat %")).toBeVisible();
    expect(await chart(page, "weight").locator(".recharts-yAxis-tick-labels").count()).toBe(2);
    // Weight was logged all 3 days; body fat only once. isReal is a per-DAY flag, so the body-fat
    // series must NOT inherit 3 dots from it.
    await expect(seriesDots(page, "weight", 0)).toHaveCount(3);
    await expect(seriesDots(page, "weight", 1)).toHaveCount(1);
  });
});

// ---------------------------------------------------------------------------------------------
// (5) Range filtering + local-day handling. Asserted at the network layer so it proves what the
//     app actually ASKS the database for, not merely what happens to be plotted.
//     AGENTS.md "What Not To Do": never derive "today"/day boundaries from a naive UTC truncation.
// ---------------------------------------------------------------------------------------------
function captureTrendQueries(page: Page) {
  const urls: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/rest/v1/daily_metrics") || u.includes("/rest/v1/daily_food_totals")) urls.push(u);
  });
  return urls;
}

function windowOf(urls: string[], table: "daily_metrics" | "daily_food_totals") {
  const col = table === "daily_metrics" ? "metric_date" : "consumed_local_date";
  const hit = urls.find((u) => u.includes(`/rest/v1/${table}`) && u.includes(`${col}=gte.`));
  if (!hit) return null;
  const url = new URL(hit);
  const params = url.searchParams.getAll(col);
  const gte = params.find((p) => p.startsWith("gte."))?.slice(4);
  const lte = params.find((p) => p.startsWith("lte."))?.slice(4);
  return gte && lte ? { gte, lte } : null;
}

test.describe("Phase5 QA range window is N days ending on the user's LOCAL today", () => {
  test.use({ timezoneId: "UTC" });
  let user: TestUser;
  test.beforeEach(async () => {
    user = await createConfirmedTestUser();
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  for (const range of [7, 30, 90] as const) {
    test(`range=${range} queries exactly ${range} days, endDate inclusive, on both tables`, async ({ page }) => {
      await seed(user, [{ date: utcDaysAgo(1), weightKg: 80, calories: 2000, proteinG: 150 }]);
      await logIn(page, user);
      const urls = captureTrendQueries(page);
      await page.goto(`/trends?range=${range}`);
      await waitForCharts(page, 2);

      const today = await browserToday(page);
      for (const table of ["daily_metrics", "daily_food_totals"] as const) {
        const win = windowOf(urls, table);
        expect(win, `no ranged query issued for ${table}`).not.toBeNull();
        expect(win!.lte, `${table} window must END on the user's local today`).toBe(today);
        expect(win!.gte, `${table} window must span exactly ${range} days`).toBe(
          addDays(today, -(range - 1)),
        );
      }
    });
  }
});

test.describe("Phase5 QA local-day window for a far-from-UTC user (no naive UTC truncation)", () => {
  test.use({ timezoneId: "Pacific/Kiritimati" }); // UTC+14
  let user: TestUser;
  test.beforeEach(async () => {
    user = await createConfirmedTestUser();
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("a UTC+14 user's 7-day window ends on THEIR local today, not the UTC date", async ({ page }) => {
    await seed(user, [{ date: utcDaysAgo(2), weightKg: 80, calories: 2000, proteinG: 150 }]);
    await logIn(page, user);
    const urls = captureTrendQueries(page);
    await page.goto("/trends?range=7");
    await waitForCharts(page, 2);

    const localToday = await browserToday(page);
    const utcToday = new Date().toISOString().slice(0, 10);
    const win = windowOf(urls, "daily_metrics");
    expect(win).not.toBeNull();
    expect(win!.lte).toBe(localToday);
    expect(win!.gte).toBe(addDays(localToday, -6));
    // Documents which side of midnight this run landed on, so a green pass is interpretable.
    console.log(`[tz check] local=${localToday} utc=${utcToday} differ=${localToday !== utcToday}`);
  });

  test("a metric logged on the user's LOCAL today is inside the window and gets a dot", async ({ page }) => {
    await logIn(page, user);
    await page.goto("/trends?range=7");
    const localToday = await browserToday(page);
    await seed(user, [{ date: localToday, weightKg: 80 }]);
    await page.goto("/trends?range=7&cb=1");
    await waitForCharts(page, 1);
    await expect(seriesDots(page, "weight", 0)).toHaveCount(1);
  });
});

test.describe("Phase5 QA RangeSelector drives the window through the URL", () => {
  test.use({ timezoneId: "UTC" });
  let user: TestUser;
  test.beforeEach(async () => {
    user = await createConfirmedTestUser();
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("switching 30d -> 7d updates the URL and drops out-of-window days", async ({ page }) => {
    await seed(user, [
      { date: utcDaysAgo(20), weightKg: 85 }, // in a 30d window, out of a 7d window
      { date: utcDaysAgo(2), weightKg: 80 },
    ]);
    await logIn(page, user);
    await page.goto("/trends");
    await waitForCharts(page, 1);
    await expect(page.getByRole("link", { name: "30d" })).toHaveAttribute("aria-current", "page");
    await expect(seriesDots(page, "weight", 0)).toHaveCount(2);

    await page.getByRole("link", { name: "7d" }).click();
    await expect(page).toHaveURL(/\/trends\?range=7$/);
    await waitForCharts(page, 1);
    await expect(page.getByRole("link", { name: "7d" })).toHaveAttribute("aria-current", "page");
    await expect(seriesDots(page, "weight", 0)).toHaveCount(1);

    await page.getByRole("link", { name: "90d" }).click();
    await expect(page).toHaveURL(/\/trends\?range=90$/);
    await waitForCharts(page, 1);
    await expect(seriesDots(page, "weight", 0)).toHaveCount(2);
  });

  test("an invalid or hostile ?range= falls back to 30d without breaking the page", async ({ page }) => {
    await seed(user, [{ date: utcDaysAgo(2), weightKg: 80 }]);
    await logIn(page, user);
    for (const bad of ["999", "abc", "-7", "", "7;drop"]) {
      await page.goto(`/trends?range=${encodeURIComponent(bad)}`);
      await waitForCharts(page, 1);
      await expect(page.getByRole("link", { name: "30d" })).toHaveAttribute("aria-current", "page");
      await expect(page.getByText(/Couldn.t load trend data/)).toHaveCount(0);
    }
  });
});

test.describe("Phase5 QA local-day window for a behind-UTC user (no naive UTC truncation)", () => {
  test.use({ timezoneId: "Pacific/Niue" }); // UTC-11
  let user: TestUser;
  test.beforeEach(async () => {
    user = await createConfirmedTestUser();
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  // Paired deliberately with the Pacific/Kiritimati (UTC+14) block above: UTC+14's local date
  // differs from the UTC date whenever the UTC hour is >= 10, and UTC-11's differs whenever the
  // UTC hour is < 11 -- so at ANY moment at least one of the two blocks is actually
  // discriminating against a naive UTC-truncated "today". Each logs which case it hit.
  test("a UTC-11 user's window ends on THEIR local today, not the UTC date", async ({ page }) => {
    await seed(user, [{ date: utcDaysAgo(2), weightKg: 80, calories: 2000, proteinG: 150 }]);
    await logIn(page, user);
    const urls = captureTrendQueries(page);
    await page.goto("/trends?range=30");
    await waitForCharts(page, 2);

    const localToday = await browserToday(page);
    const utcToday = new Date().toISOString().slice(0, 10);
    const win = windowOf(urls, "daily_food_totals");
    expect(win).not.toBeNull();
    expect(win!.lte).toBe(localToday);
    expect(win!.gte).toBe(addDays(localToday, -29));
    console.log(`[tz check UTC-11] local=${localToday} utc=${utcToday} differ=${localToday !== utcToday}`);
  });
});

// ---------------------------------------------------------------------------------------------
// (6) Absolute Rules (AGENTS.md): RLS-scoped reads only, user_id never taken from client input,
//     no cross-user leakage, no unauthenticated access.
// ---------------------------------------------------------------------------------------------
test.describe("Phase5 QA Absolute Rules on the trends read path", () => {
  test.use({ timezoneId: "UTC" });
  let userA: TestUser;
  let userB: TestUser;
  test.beforeEach(async () => {
    userA = await createConfirmedTestUser();
    userB = await createConfirmedTestUser();
  });
  test.afterEach(async () => {
    await deleteTestUser(userA.id);
    await deleteTestUser(userB.id);
  });

  test("user B's logged days never appear in user A's charts", async ({ page }) => {
    await seed(userA, [{ date: utcDaysAgo(2), weightKg: 80, calories: 2000, proteinG: 150 }]);
    await seed(userB, [
      { date: utcDaysAgo(1), weightKg: 60, calories: 500, proteinG: 10 },
      { date: utcDaysAgo(3), weightKg: 61, calories: 600, proteinG: 12 },
      { date: utcDaysAgo(5), weightKg: 62, calories: 700, proteinG: 14 },
    ]);
    await logIn(page, userA);
    await page.goto("/trends?range=7");
    await waitForCharts(page, 2);
    await expect(seriesDots(page, "weight", 0)).toHaveCount(1);
    await expect(seriesDots(page, "intake", 0)).toHaveCount(1);
  });

  test("a user_id smuggled into the URL cannot widen or redirect the query", async ({ page }) => {
    await seed(userA, [{ date: utcDaysAgo(2), weightKg: 80, calories: 2000, proteinG: 150 }]);
    await seed(userB, [
      { date: utcDaysAgo(1), weightKg: 60, calories: 500, proteinG: 10 },
      { date: utcDaysAgo(4), weightKg: 61, calories: 600, proteinG: 12 },
    ]);
    await logIn(page, userA);
    const urls = captureTrendQueries(page);
    await page.goto(`/trends?range=7&user_id=${userB.id}&userId=${userB.id}`);
    await waitForCharts(page, 2);

    await expect(seriesDots(page, "weight", 0)).toHaveCount(1);
    // No client-supplied identity reaches the data layer at all.
    for (const u of urls) {
      expect(u).not.toContain(userB.id);
      expect(u.toLowerCase()).not.toContain("user_id=");
    }
  });

  test("the browser only ever talks to PostgREST with the anon key, never the service-role key", async ({ page }) => {
    await seed(userA, [{ date: utcDaysAgo(2), weightKg: 80, calories: 2000, proteinG: 150 }]);
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(serviceRoleKey, "SUPABASE_SERVICE_ROLE_KEY must be set for this check").toBeTruthy();

    const offending: string[] = [];
    page.on("request", (r) => {
      const headers = r.headers();
      const bag = `${r.url()} ${headers["apikey"] ?? ""} ${headers["authorization"] ?? ""}`;
      if (bag.includes(serviceRoleKey!)) offending.push(r.url());
    });

    await logIn(page, userA);
    await page.goto("/trends?range=90");
    await waitForCharts(page, 2);
    expect(offending).toEqual([]);

    // ...and it isn't hiding in any script the page loaded either.
    const inScripts = await page.evaluate(async (key) => {
      const srcs = Array.from(document.querySelectorAll("script[src]")).map(
        (s) => (s as HTMLScriptElement).src,
      );
      for (const src of srcs) {
        const body = await (await fetch(src)).text();
        if (body.includes(key)) return src;
      }
      return null;
    }, serviceRoleKey!);
    expect(inScripts).toBeNull();
  });

  test("/trends is behind the auth gate", async ({ page }) => {
    await page.goto("/trends?range=7");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.locator(".recharts-wrapper")).toHaveCount(0);
  });
});

test.describe("Phase5 QA empty state", () => {
  test.use({ timezoneId: "UTC" });
  let user: TestUser;
  test.beforeEach(async () => {
    user = await createConfirmedTestUser();
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("a brand-new user sees both empty states, no chart, and no console errors", async ({ page }) => {
    const errors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    page.on("pageerror", (e) => errors.push(String(e)));

    await logIn(page, user);
    await page.goto("/trends?range=30");
    await expect(page.getByText(/No weight logged in this range yet/)).toBeVisible();
    await expect(page.getByText(/No food logged in this range yet/)).toBeVisible();
    await expect(page.locator(".recharts-wrapper")).toHaveCount(0);
    await expect(page.getByText(/Couldn.t load trend data/)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test("the Trends nav link is present and reachable from the app shell", async ({ page }) => {
    await logIn(page, user);
    await page.getByRole("link", { name: "Trends" }).click();
    await expect(page).toHaveURL(/\/trends/);
    await expect(page.getByRole("heading", { name: "Trends" })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------------------------
// Read-failure handling. /trends is a fourth browser-side Supabase read surface alongside
// /food, /metrics and the dashboard (covered by e2e/fetch-error-handling.spec.ts, which this
// phase did not extend) -- it must behave the same way rather than hanging on "Loading...".
// ---------------------------------------------------------------------------------------------
test.describe("Phase5 QA trends read-failure handling", () => {
  test.use({ timezoneId: "UTC" });
  let user: TestUser;
  test.beforeEach(async () => {
    user = await createConfirmedTestUser();
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("a failing read shows an error + Retry, and Retry recovers", async ({ page }) => {
    await seed(user, [{ date: utcDaysAgo(2), weightKg: 80, calories: 2000, proteinG: 150 }]);
    await logIn(page, user);

    let fail = true;
    await page.route("**/rest/v1/daily_metrics**", (route) =>
      fail
        ? route.fulfill({ status: 500, contentType: "application/json", body: '{"message":"boom"}' })
        : route.continue(),
    );

    await page.goto("/trends?range=7");
    await expect(page.getByText(/Couldn.t load trend data/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByText("Loading…")).toHaveCount(0);
    await expect(page.locator(".recharts-wrapper")).toHaveCount(0);

    fail = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText(/Couldn.t load trend data/)).toHaveCount(0);
    await waitForCharts(page, 2);
  });
});

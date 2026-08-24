import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";

/**
 * QA-REVIEWER independent Phase 8h acceptance suite -- "Retire the dashboard; last-logged weight
 * moves to /metrics".
 *
 * Written from docs/architecture/food-weight-tracker.md 3.4's "Retiring the dashboard" block, 6's
 * matching rows and 8's Phase 8h section -- NOT from the implementation.
 *
 * The two rows 6 says to hammer: (1) "/" genuinely lands on a WORKING /food -- asserted on the
 * final URL AND real rendered content, since a redirect that 200s on an empty page passes a naive
 * check; and (2) the last-logged line updates after a save WITHOUT a reload, which is the single
 * behaviour the client-read choice exists to guarantee and the one a "simplification" back to a
 * Server Component read would silently break.
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
  // Await the redirect before any further navigation -- otherwise a subsequent page.goto races the
  // login POST and lands back on /login.
  await expect(page).toHaveURL("/food", { timeout: 15000 });
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

async function seedMetric(date: string, weightKg: number, bodyFat: number | null) {
  const { error } = await client
    .from("daily_metrics")
    .upsert(
      { user_id: user.id, metric_date: date, weight_kg: weightKg, body_fat_pct: bodyFat },
      { onConflict: "user_id,metric_date" },
    );
  if (error) throw new Error("seedMetric failed: " + error.message);
}

async function clearMetrics() {
  await client.from("daily_metrics").delete().eq("user_id", user.id);
}

async function setWeightUnit(unit: "kg" | "lb") {
  const { error } = await client
    .from("user_goals")
    .upsert({ user_id: user.id, weight_unit: unit }, { onConflict: "user_id" });
  if (error) throw new Error("setWeightUnit failed: " + error.message);
}

async function gotoMetrics(page: Page) {
  await page.goto("/metrics");
  // MetricForm resolves tz in a mount-only Effect and shows a placeholder until then.
  await expect(page.locator("#metric-day")).toBeVisible({ timeout: 15000 });
}

test.describe("Phase 8h -- the dashboard is retired", () => {
  test("logging in lands on a WORKING /food, not a dashboard", async ({ page }) => {
    await logIn(page);
    await expect(page).toHaveURL("/food");
    // Real rendered content, not just a 200: the day log's own controls and its totals card.
    await expect(page.getByRole("heading", { name: "Food log" })).toBeVisible({ timeout: 15000 });
    await expect(page.getByRole("button", { name: "Log a saved meal", exact: true })).toBeVisible();
    await expect(page.getByText("Calories", { exact: true })).toBeVisible();
  });

  test("a DIRECT visit to / redirects to a working /food", async ({ page }) => {
    await logIn(page);
    await page.goto("/");
    await expect(page).toHaveURL("/food");
    await expect(page.getByRole("heading", { name: "Food log" })).toBeVisible({ timeout: 15000 });
  });

  test("the header wordmark still works (it links to /, which now redirects)", async ({ page }) => {
    await logIn(page);
    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible({ timeout: 15000 });

    // This is the link most likely to be broken by a careless route deletion.
    const wordmark = page.getByRole("link", { name: "Health Tracker", exact: true });
    await expect(wordmark).toBeVisible();
    await expect(wordmark).toHaveAttribute("href", "/");
    await wordmark.click();
    await expect(page).toHaveURL("/food");
    await expect(page.getByRole("heading", { name: "Food log" })).toBeVisible({ timeout: 15000 });
  });

  test("nothing dashboard-shaped remains anywhere in the app", async ({ page }) => {
    await logIn(page);
    for (const path of ["/food", "/meals", "/metrics", "/trends", "/settings"]) {
      await page.goto(path);
      await expect(page.getByText(/Today so far/i)).toHaveCount(0);
      await expect(page.getByText(/Welcome back/i)).toHaveCount(0);
    }
  });

  test("logging out still works from the redirected landing page", async ({ page }) => {
    await logIn(page);
    await expect(page).toHaveURL("/food");
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL("/login");
    // The session is genuinely gone: / no longer resolves to the app.
    await page.goto("/");
    await expect(page).toHaveURL("/login");
  });
});

test.describe("Phase 8h -- the last-logged line on /metrics", () => {
  test.beforeEach(async () => {
    await clearMetrics();
    await setWeightUnit("kg");
  });

  test("with NO metrics ever logged, the line is absent entirely -- not 'Last logged: —'", async ({
    page,
  }) => {
    await logIn(page);
    await gotoMetrics(page);

    await expect(page.getByText(/Last logged/i)).toHaveCount(0);
    // ...and specifically not an empty-value placeholder.
    await expect(page.getByText(/Last logged:\s*—/)).toHaveCount(0);
  });

  test("shows the MOST RECENT day, not the selected day and not the oldest", async ({ page }) => {
    await seedMetric(daysAgo(20), 80, 25); // older
    await seedMetric(daysAgo(5), 82.5, 18.2); // most recent
    await logIn(page);
    await gotoMetrics(page);

    const line = page.getByText(/Last logged:/);
    await expect(line).toBeVisible();
    const text = (await line.textContent()) ?? "";
    expect(text).toContain("82.5 kg");
    expect(text).toContain("18.2% body fat");
    expect(text).not.toContain("80 kg");
    // A human-readable date (formatDateLabel), not a raw ISO string.
    expect(text).not.toContain(daysAgo(5));
    const [y, m, d] = daysAgo(5).split("-");
    expect(text).toContain(m + "/" + d + "/" + y);
  });

  test("renders in the user's chosen unit -- a kg->lb toggle changes it (a hardcoded unit fails)", async ({
    page,
  }) => {
    await seedMetric(daysAgo(3), 80, null);
    await logIn(page);
    await gotoMetrics(page);
    await expect(page.getByText(/Last logged:/)).toContainText("80 kg");

    await setWeightUnit("lb");
    await page.reload();
    await expect(page.locator("#metric-day")).toBeVisible({ timeout: 15000 });

    const text = (await page.getByText(/Last logged:/).textContent()) ?? "";
    expect(text).toContain("lb");
    expect(text).not.toContain("kg");
    // 80 kg == 176.4 lb, so the value is genuinely converted, not relabelled.
    expect(text).toMatch(/17[0-9](\.\d+)?\s*lb/);
  });

  test("a weight-only day shows no body-fat clause", async ({ page }) => {
    await seedMetric(daysAgo(2), 77.7, null);
    await logIn(page);
    await gotoMetrics(page);

    const text = (await page.getByText(/Last logged:/).textContent()) ?? "";
    expect(text).toContain("77.7 kg");
    expect(text).not.toContain("body fat");
  });

  test("THE ROW TO HAMMER: it updates after a save WITHOUT a page reload", async ({ page }) => {
    await seedMetric(daysAgo(6), 80, null);
    await logIn(page);
    await gotoMetrics(page);

    const oldDate = daysAgo(6).split("-");
    await expect(page.getByText(/Last logged:/)).toContainText(
      oldDate[1] + "/" + oldDate[2] + "/" + oldDate[0],
    );

    // Log today's weight through the real form -- no navigation, no reload.
    await page.getByLabel(/^Weight \(/).fill("79.1");
    // The submit button reads "Log entry" for a day with no existing row, "Save changes" otherwise.
    await page.getByRole("button", { name: /^(Log entry|Save changes)$/ }).click();

    const today = new Date().toISOString().slice(0, 10).split("-");
    await expect(page.getByText(/Last logged:/)).toContainText(
      today[1] + "/" + today[2] + "/" + today[0],
      { timeout: 15000 },
    );
    await expect(page.getByText(/Last logged:/)).toContainText("79.1 kg");
    // This is the whole reason it is a CLIENT read: a Server Component read would still be naming
    // the old day here until a navigation.
  });

  test("deleting the newest day's entry moves the line back to the previous one, without a reload", async ({
    page,
  }) => {
    await seedMetric(daysAgo(9), 85, null);
    const today = new Date().toISOString().slice(0, 10);
    await seedMetric(today, 79, null);
    await logIn(page);
    await gotoMetrics(page);
    await expect(page.getByText(/Last logged:/)).toContainText("79 kg");

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: /delete/i }).first().click();

    await expect(page.getByText(/Last logged:/)).toContainText("85 kg", { timeout: 15000 });
  });
});

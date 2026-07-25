import { test, expect, type Page } from "@playwright/test";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";

// A failed browser-side Supabase read must surface a visible error state, not an infinite
// "Loading…". Forces failure with a 500 on the REST reads.

async function logIn(page: Page, user: TestUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
}

const fail500 = (route: import("@playwright/test").Route) =>
  route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "boom" }) });

test.describe("browser-fetch error handling", () => {
  let user: TestUser;
  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("/food shows an error + Retry when the read fails, not an infinite spinner", async ({ page }) => {
    await page.route("**/rest/v1/**", fail500);
    await page.goto("/food");
    await expect(page.getByText(/Couldn.t load this day.s entries/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(page.getByText("Loading…")).toHaveCount(0);
  });

  test("/metrics shows an error + Retry when the read fails", async ({ page }) => {
    await page.route("**/rest/v1/**", fail500);
    await page.goto("/metrics");
    await expect(page.getByText(/Couldn.t load this day.s entry/i)).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  });

  test("dashboard shows a totals error when the read fails", async ({ page }) => {
    await page.route("**/rest/v1/**", fail500);
    await page.goto("/");
    await expect(page.getByText(/Couldn.t load today.s totals/i)).toBeVisible();
  });

  test("Retry re-issues the fetch and recovers once the backend is reachable again", async ({ page }) => {
    let fail = true;
    await page.route("**/rest/v1/**", (route) => (fail ? fail500(route) : route.continue()));
    await page.goto("/food");
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    fail = false;
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.getByText(/Couldn.t load this day.s entries/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry" })).toHaveCount(0);
  });
});

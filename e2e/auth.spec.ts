import { test, expect } from "@playwright/test";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";

/**
 * Phase 1 acceptance coverage per docs/architecture/food-weight-tracker.md §8:
 *   "Auth gating (unauthenticated access to every (app) route redirects/401s); persistent login
 *    (reload/cookie-refresh keeps the session; 'Log out' clears it and re-gates)."
 *
 * Requires `npx supabase start` running locally (or an equivalent CI service) plus the env vars
 * in .env.example, including SUPABASE_SERVICE_ROLE_KEY. Not run in this sandbox (no Docker
 * available) — qa-reviewer should run this for real against a local Supabase stack as part of
 * the Phase 1 checkpoint, and is expected to write its own independent acceptance tests from the
 * spec rather than rely solely on this developer-authored harness.
 */

test.describe("auth gating", () => {
  test("unauthenticated visit to a protected route redirects to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("unauthenticated visit to a nested (app) route also redirects to /login", async ({
    page,
  }) => {
    // Phase 1 has no feature routes yet (food/meals/metrics/trends don't exist until later
    // phases), so this exercises the layout-level gate via the one route that does exist: "/".
    await page.goto("/?next=elsewhere");
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("login / logout / persistent session", () => {
  let user: TestUser;

  test.beforeEach(async () => {
    user = await createConfirmedTestUser();
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("logging in with valid credentials reaches the dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page).toHaveURL("/");
    await expect(page.getByText(user.email)).toBeVisible();
  });

  test("an invalid password shows an error and does not grant access", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Log in" }).click();

    await expect(page.getByText(/invalid login credentials/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("session persists across a reload (persistent login)", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL("/");

    await page.reload();

    await expect(page).toHaveURL("/");
    await expect(page.getByText(user.email)).toBeVisible();
  });

  test("logging out clears the session and re-gates protected routes", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL("/");

    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);

    // Confirm the session is really gone, not just the current page's UI state.
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });
});

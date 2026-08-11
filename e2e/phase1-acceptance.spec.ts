import { test, expect } from "@playwright/test";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createAdminClient } from "./helpers/admin-client";
import { randomUUID } from "node:crypto";

/**
 * Independent qa-reviewer acceptance tests for Phase 1, written from the design doc §6/§8
 * (auth gating + persistent login + built-in email confirmation) rather than from the
 * implementation. Complements the developer-authored e2e/auth.spec.ts; uses unambiguous,
 * role-scoped locators (the developer spec's getByText(email) is ambiguous — the email renders
 * both in the nav and the dashboard body).
 */

// ---- Auth gating (unauthenticated) --------------------------------------------------------

test.describe("auth gating (independent)", () => {
  test("the login page itself is reachable without a session (no redirect loop)", async ({
    page,
  }) => {
    await page.goto("/login");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Log in" })).toBeVisible();
  });

  test("the signup page is reachable without a session", async ({ page }) => {
    await page.goto("/signup");
    await expect(page).toHaveURL(/\/signup$/);
    await expect(page.getByRole("button", { name: "Sign up" })).toBeVisible();
  });

  test("protected dashboard redirects an unauthenticated visitor to /login", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    // The protected content (Log out control) must not be present.
    await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
  });

  test("an invalid auth-callback code redirects to /login with an error notice", async ({
    page,
  }) => {
    await page.goto("/auth/callback?code=totally-invalid-code");
    await expect(page).toHaveURL(/\/login\?error=auth_callback_failed/);
    await expect(page.getByText(/invalid or expired/i)).toBeVisible();
  });
});

// ---- Login / persistent login / logout ----------------------------------------------------

test.describe("session lifecycle (independent)", () => {
  let user: TestUser;

  test.beforeEach(async () => {
    user = await createConfirmedTestUser();
  });

  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  async function logIn(page: import("@playwright/test").Page, email: string, password: string) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
  }

  test("valid login reaches /food (Phase 8h: the dashboard route redirects there; unambiguous signal: Log out control)", async ({
    page,
  }) => {
    await logIn(page, user.email, user.password);
    await expect(page).toHaveURL("/food");
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
    // Email shown in the nav specifically (role-scoped to avoid the body duplicate).
    await expect(page.getByRole("navigation").getByText(user.email)).toBeVisible();
  });

  test("session persists across a full reload", async ({ page }) => {
    await logIn(page, user.email, user.password);
    await expect(page).toHaveURL("/food");
    await page.reload();
    await expect(page).toHaveURL("/food");
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  });

  test("session persists when navigating away and back to a protected route", async ({ page }) => {
    await logIn(page, user.email, user.password);
    await expect(page).toHaveURL("/food");
    await page.goto("/login"); // visit an unauthenticated page
    await page.goto("/"); // come back — middleware-refreshed cookie should still authenticate
    await expect(page).toHaveURL("/food");
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  });

  test("session survives in a brand-new browser context sharing the storage state", async ({
    page,
    browser,
  }) => {
    await logIn(page, user.email, user.password);
    await expect(page).toHaveURL("/food");
    const storage = await page.context().storageState();
    const ctx2 = await browser.newContext({ storageState: storage });
    const page2 = await ctx2.newPage();
    await page2.goto("/");
    await expect(page2).toHaveURL("/food");
    await expect(page2.getByRole("button", { name: "Log out" })).toBeVisible();
    await ctx2.close();
  });

  test("logging out clears the session and re-gates protected routes", async ({ page }) => {
    await logIn(page, user.email, user.password);
    await expect(page).toHaveURL("/food");
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("a wrong password is rejected and grants no access", async ({ page }) => {
    await logIn(page, user.email, "wrong-" + user.password);
    await expect(page.getByText(/invalid login credentials/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
  });
});

// ---- Built-in email confirmation is actually enforced (adversarial) -----------------------

test.describe("email confirmation enforcement (independent)", () => {
  test("an UNCONFIRMED user cannot log in (config enable_confirmations holds)", async ({
    page,
  }) => {
    const admin = createAdminClient();
    const email = `e2e-unconf-${randomUUID()}@example.test`;
    const password = `Test-${randomUUID()}`;
    // Create WITHOUT email_confirm — mirrors a real signup that hasn't clicked the email link.
    const { data, error } = await admin.auth.admin.createUser({ email, password });
    expect(error, error?.message).toBeNull();
    const userId = data.user!.id;
    try {
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Log in" }).click();
      // Must be blocked: no session, stays on /login, an error surfaces.
      await expect(page).toHaveURL(/\/login$/);
      await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
      await expect(page.locator("p.text-red-600")).toBeVisible();
    } finally {
      await admin.auth.admin.deleteUser(userId);
    }
  });

  test("signup surfaces the 'check your email' confirmation state, no session granted", async ({
    page,
  }) => {
    const email = `e2e-signup-${randomUUID()}@example.test`;
    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm password").fill("password123");
    await page.getByRole("button", { name: "Sign up" }).click();
    await expect(page.getByText(/check your email/i)).toBeVisible();
    // No session should exist yet — the protected route still redirects.
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
    // Cleanup: find + delete the just-created user via admin API.
    const admin = createAdminClient();
    const { data } = await admin.auth.admin.listUsers();
    const created = data.users.find((u) => u.email === email);
    if (created) await admin.auth.admin.deleteUser(created.id);
  });
});

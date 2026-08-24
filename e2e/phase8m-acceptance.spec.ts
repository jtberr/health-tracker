import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";

/**
 * QA-REVIEWER independent Phase 8m acceptance suite -- "Password reset".
 *
 * Written from docs/architecture/food-weight-tracker.md 3.4 (the Phase 8m block), 6's
 * "Password reset" rows and 8 Phase 8m's own In/Out scope, plus ai-context/DECISIONS.md's
 * 2026-08-11 Phase 8m entry -- NOT from the developer's implementation, which was read only
 * afterwards to look for gaps.
 *
 * TWO MECHANICS THAT SHAPE EVERY TEST HERE, both established empirically against the running
 * stack rather than assumed:
 *
 * 1. THE LINK IS PKCE-BOUND TO THE REQUESTING BROWSER. requestPasswordReset runs on the server
 *    client, which stores a PKCE code verifier in a cookie; /auth/callback's exchangeCodeForSession
 *    needs that cookie. So a reset link only works in the SAME browser context that requested it
 *    (the design doc names "a link opened in a different browser" as an expected expired case).
 *    Every test therefore requests and follows the link on the same `page`.
 * 2. LOCATOR COLLISIONS. /reset-password renders two controls whose accessible names both contain
 *    "password"; getByLabel is a case-insensitive SUBSTRING match. Every getByLabel below uses
 *    { exact: true } -- the fifth instance of the class recorded in ai-context/DECISIONS.md's
 *    "Copy to time..." entry and its addenda.
 */

const MAILPIT = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
const OLD_PASSWORD = "OldPass-12345";
const NEW_PASSWORD = "NewPass-67890";

// ---- Mailpit (the local mail catcher the whole stack already runs) --------------------------

async function mailpit(path: string, init?: RequestInit) {
  const res = await fetch(MAILPIT + path, init);
  if (!res.ok) {
    throw new Error(
      "Mailpit at " + MAILPIT + " returned " + res.status + " for " + path +
        ". The Phase 8m round-trip rows require the local Supabase stack's mail catcher.",
    );
  }
  return res;
}

/** The reset link Supabase emailed to `address`, waited for rather than assumed-instant. */
async function resetLinkFor(address: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const found = await (
      await mailpit("/api/v1/search?query=" + encodeURIComponent("to:" + address))
    ).json();
    const message = found.messages?.[0];
    if (message) {
      const full = await (await mailpit("/api/v1/message/" + message.ID)).json();
      const body: string = full.HTML || full.Text || "";
      const href = body.match(/https?:\/\/[^"'\s<>]+/);
      if (href) return href[0].replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("No reset email arrived for " + address + " within 15s");
}

// ---- Real credential checks, made through Supabase itself, not through the UI ---------------

/**
 * Deliberately checks the credential at the auth provider rather than by driving /login: the row
 * to hammer is "the new password works and the old one does not", and asserting that against the
 * source of truth cannot be satisfied by a UI that merely looks right.
 */
async function passwordWorks(email: string, password: string): Promise<boolean> {
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email, password });
  return !error;
}

/** Drives /forgot-password for real and follows the emailed link, landing on /reset-password. */
async function openResetPageFor(page: Page, user: TestUser) {
  await page.goto("/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByText(/we've sent a link/i)).toBeVisible();
  const link = await resetLinkFor(user.email);
  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password/);
  return link;
}

/** The one confirmation string /forgot-password renders for `address`, whatever it is. */
async function confirmationTextFor(context: BrowserContext, address: string): Promise<string> {
  const page = await context.newPage();
  await page.goto("/forgot-password");
  await page.getByLabel("Email", { exact: true }).fill(address);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await page.waitForTimeout(1500);
  const text = (await page.locator("body").innerText())
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /account exists|sent a link|couldn't send|no account|not found/i.test(l))
    .join(" ");
  await page.close();
  return text;
}

let user: TestUser;

test.beforeEach(async () => {
  user = await createConfirmedTestUser(OLD_PASSWORD);
});

test.afterEach(async () => {
  if (user) await deleteTestUser(user.id);
});

// ============================================================================================
// THE ROW TO HAMMER #1 -- the whole flow works end to end against the real local stack
// ============================================================================================

test.describe("Phase 8m -- full round trip", () => {
  test("the emailed link lands on a real /reset-password form", async ({ page }) => {
    await openResetPageFor(page, user);
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
    await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Confirm new password", { exact: true })).toBeVisible();
  });

  test("after the reset the NEW password works AND the OLD one no longer does", async ({ page }) => {
    // Both halves, per 6: asserting only the success half would pass against an action that
    // silently did nothing at all.
    expect(await passwordWorks(user.email, OLD_PASSWORD), "old password before").toBe(true);

    await openResetPageFor(page, user);
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Set new password" }).click();
    await page.waitForURL(/\/login/);

    expect(await passwordWorks(user.email, NEW_PASSWORD), "NEW password after").toBe(true);
    expect(await passwordWorks(user.email, OLD_PASSWORD), "OLD password after").toBe(false);
  });

  test("success leaves the user signed OUT, on /login?reset=success, and says so", async ({ page }) => {
    await openResetPageFor(page, user);
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Set new password" }).click();

    await expect(page).toHaveURL(/\/login\?reset=success/);
    await expect(page.getByText(/your password has been reset/i)).toBeVisible();
    // Signed out is the point (the session was minted by an emailed link, not by the password):
    // the authenticated header's control is absent, and /food does not admit us.
    await expect(page.getByRole("button", { name: "Log out" })).toHaveCount(0);
    await page.goto("/food");
    await expect(page).toHaveURL(/\/login/);
  });
});

// ============================================================================================
// THE ROW TO HAMMER #2 -- no account-existence oracle
// ============================================================================================

test.describe("Phase 8m -- the confirmation must not reveal whether an account exists", () => {
  test("an unknown address renders a byte-identical confirmation to a known one", async ({ context }) => {
    const known = await confirmationTextFor(context, user.email);
    const unknown = await confirmationTextFor(context, "qa8m-no-such-account@example.test");
    expect(known.length, "the known-address confirmation must not be empty").toBeGreaterThan(0);
    expect(unknown, "known vs unknown confirmation").toBe(known);
  });

  test("the page never says 'no account' / 'not found' / 'unknown' for an unknown address", async ({ page }) => {
    await page.goto("/forgot-password");
    await page.getByLabel("Email", { exact: true }).fill("qa8m-definitely-nobody@example.test");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/we've sent a link/i)).toBeVisible();
    const body = await page.locator("body").innerText();
    for (const phrase of [/no account/i, /not found/i, /unknown/i, /doesn't exist/i, /no user/i]) {
      expect(body, "leaked account-existence phrasing " + phrase).not.toMatch(phrase);
    }
  });

  test("FINDING B-1 (pinned, NOT endorsed): a throttled send makes known and unknown distinguishable", async ({ context }) => {
    // Pins CURRENT behaviour so the fix flips this test rather than leaving the defect silent.
    //
    // requestPasswordReset surfaces a genuine send failure with its own distinct message (the
    // design doc's deliberate choice, so a user is never told an email is coming when it is not).
    // But a send can only FAIL for an address that HAS an account -- Supabase never sends, and so
    // never throttles, for an address that does not. So the two messages diverge, defeating the
    // phase's one security property.
    //
    // The priming call below is exactly what a second click on "Send reset link" does; it is made
    // over HTTP purely because the local per-user window is 1s, faster than a browser round trip.
    // On a hosted project that window defaults to 60s and the built-in sender's hourly cap is
    // small, so an ordinary double-click reproduces it.
    const prime = (address: string) =>
      fetch(process.env.NEXT_PUBLIC_SUPABASE_URL + "/auth/v1/recover", {
        method: "POST",
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: address }),
      });

    const page = await context.newPage();
    const submit = async (address: string) => {
      await page.goto("/forgot-password");
      await page.getByLabel("Email", { exact: true }).fill(address);
      await prime(address);
      await page.getByRole("button", { name: "Send reset link" }).click();
      await page.waitForTimeout(2000);
      return (await page.locator("body").innerText())
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /account exists|couldn't send/i.test(l))
        .join(" ");
    };

    const known = await submit(user.email);
    const unknown = await submit("qa8m-no-such-account-2@example.test");
    await page.close();

    expect(unknown).toMatch(/account exists/i);
    // THE DEFECT: a known address is distinguishable from an unknown one by the rendered message.
    expect(known).toMatch(/couldn't send/i);
    expect(known, "FINDING B-1: known and unknown are distinguishable").not.toBe(unknown);
  });
});

// ============================================================================================
// The link is single-use, and the generalised failure copy keeps the substring 8l/1 rely on
// ============================================================================================

test.describe("Phase 8m -- a used reset link cannot be replayed", () => {
  test("revisiting a consumed link lands on /login?error=auth_callback_failed", async ({ page }) => {
    const link = await openResetPageFor(page, user);
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Set new password" }).click();
    await page.waitForURL(/\/login/);

    await page.goto(link);
    await expect(page).toHaveURL(/\/login\?error=auth_callback_failed/);
    // The exact assertion e2e/phase1-acceptance.spec.ts makes -- the generalised copy must keep it.
    await expect(page.getByText(/invalid or expired/i)).toBeVisible();
  });

  test("a replayed link does not re-open the reset form", async ({ page }) => {
    const link = await openResetPageFor(page, user);
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Set new password" }).click();
    await page.waitForURL(/\/login/);
    await page.goto(link);
    // NB: assert on the reset form SPECIFICALLY. /login has its own input#password, so a bare
    // id/type selector matches the landing page and proves nothing -- same substring-collision
    // family as the getByLabel hazard this file opens with.
    await expect(page).toHaveURL(new RegExp("/login"));
    await expect(page.getByRole("button", { name: "Set new password" })).toHaveCount(0);
    await expect(page.getByLabel("Confirm new password", { exact: true })).toHaveCount(0);
  });
});

// ============================================================================================
// /reset-password with no session, and the action's own independent re-check
// ============================================================================================

test.describe("Phase 8m -- /reset-password without a valid recovery session", () => {
  test("explains itself and renders NO password form at all", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
    // The absence is the assertion: a form that renders and can only fail on submit is exactly
    // the failure mode this page exists to avoid.
    await expect(page.locator("input[type=password]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Set new password" })).toHaveCount(0);
    await expect(page.locator('a[href="/forgot-password"]')).toHaveCount(1);
  });

  test("the ACTION re-checks independently -- the page's check is UX, not authorisation", async ({
    page,
    context,
  }) => {
    // Reach a state the page-level check would have blocked: render the form with a valid
    // session, then destroy the session before submitting. Only the action can catch this.
    await openResetPageFor(page, user);
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password", { exact: true }).fill(NEW_PASSWORD);
    await context.clearCookies();
    await page.getByRole("button", { name: "Set new password" }).click();
    await page.waitForTimeout(1500);

    expect(await passwordWorks(user.email, NEW_PASSWORD), "must NOT have changed").toBe(false);
    expect(await passwordWorks(user.email, OLD_PASSWORD), "old password intact").toBe(true);
    await expect(page).not.toHaveURL(/reset=success/);
    await expect(page.getByText(/invalid or has expired/i)).toBeVisible();
    // The short code is an internal contract, not user-facing copy.
    await expect(page.locator("body")).not.toContainText("reset_session_missing");
  });
});

// ============================================================================================
// Validation is server-side, not merely an <input minLength>
// ============================================================================================

test.describe("Phase 8m -- validation survives a client that bypasses the native constraints", () => {
  /** Strips the native constraints so the submit actually reaches the Server Action. */
  async function defeatNativeValidation(page: Page) {
    await page.evaluate(() => {
      document.querySelectorAll("input").forEach((i) => {
        i.removeAttribute("minlength");
        i.removeAttribute("required");
      });
    });
  }

  test("a too-short password is rejected server-side and changes nothing", async ({ page }) => {
    await openResetPageFor(page, user);
    await defeatNativeValidation(page);
    await page.getByLabel("New password", { exact: true }).fill("abc");
    await page.getByLabel("Confirm new password", { exact: true }).fill("abc");
    await page.getByRole("button", { name: "Set new password" }).click();

    await expect(page.getByText(/at least 6 characters/i)).toBeVisible();
    await expect(page).toHaveURL(/\/reset-password/);
    expect(await passwordWorks(user.email, "abc")).toBe(false);
    expect(await passwordWorks(user.email, OLD_PASSWORD), "old password intact").toBe(true);
  });

  test("a mismatched confirmation is rejected server-side and changes nothing", async ({ page }) => {
    await openResetPageFor(page, user);
    await defeatNativeValidation(page);
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password", { exact: true }).fill("something-else");
    await page.getByRole("button", { name: "Set new password" }).click();

    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
    expect(await passwordWorks(user.email, NEW_PASSWORD)).toBe(false);
    expect(await passwordWorks(user.email, OLD_PASSWORD), "old password intact").toBe(true);
  });

  test("both problems are reported at once, not one after the other", async ({ page }) => {
    await openResetPageFor(page, user);
    await defeatNativeValidation(page);
    await page.getByLabel("New password", { exact: true }).fill("abc");
    await page.getByLabel("Confirm new password", { exact: true }).fill("zzz");
    await page.getByRole("button", { name: "Set new password" }).click();

    await expect(page.getByText(/at least 6 characters/i)).toBeVisible();
    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
  });
});

// ============================================================================================
// ?next= cannot be turned into an open redirect through this flow
// ============================================================================================

test.describe("Phase 8m -- the callback's open-redirect guard, now on a routinely-used parameter", () => {
  test("a VALID code with next=//evil.com still lands same-origin", async ({ page }) => {
    // Deliberately exercised with a code that actually EXCHANGES. A bogus code fails before the
    // redirect is ever computed, so it proves nothing about safeRedirectPath -- the trap this
    // test exists to avoid falling into.
    await page.goto("/forgot-password");
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText(/we've sent a link/i)).toBeVisible();

    const verifyUrl = await resetLinkFor(user.email);
    const res = await fetch(verifyUrl, { redirect: "manual" });
    const code = new URL(res.headers.get("location")!).searchParams.get("code");
    expect(code, "GoTrue must hand /auth/callback a real ?code=").toBeTruthy();

    await page.goto("/auth/callback?code=" + code + "&next=" + encodeURIComponent("//evil.com"));
    expect(new URL(page.url()).host, "must never leave our origin").toBe("localhost:3000");
    await expect(page).toHaveURL(/^http:\/\/localhost:3000\//);
    expect(page.url()).not.toContain("evil.com");
  });

  test("an off-origin next is rejected for every shape, not just the leading //", async ({ page }) => {
    for (const next of ["//evil.com", "/\evil.com", "https://evil.com", "http://evil.com"]) {
      await page.goto("/auth/callback?code=bogus&next=" + encodeURIComponent(next));
      await expect(page).toHaveURL(/^http:\/\/localhost:3000\//);
      expect(page.url(), "next=" + next).not.toContain("evil.com");
    }
  });
});

// ============================================================================================
// The login page offers the way in
// ============================================================================================

test.describe("Phase 8m -- /login offers the way in and /forgot-password is reachable logged out", () => {
  test("a 'Forgot password?' link on /login goes to /forgot-password", async ({ page }) => {
    await page.goto("/login");
    const link = page.getByRole("link", { name: /forgot password/i });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(page.getByRole("heading", { name: /reset your password/i })).toBeVisible();
  });

  test("/forgot-password renders logged out with no redirect loop", async ({ page }) => {
    const res = await page.goto("/forgot-password");
    expect(res?.status()).toBe(200);
    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  });
});

// ============================================================================================
// Scope / adversarial: what the recovery-session check does NOT distinguish
// ============================================================================================

test.describe("Phase 8m -- what 'is there a session' does and does not mean", () => {
  test("FINDING N-1 (pinned, NOT endorsed): an ordinary signed-in session can change the password with no re-auth", async ({
    page,
  }) => {
    // Pins CURRENT behaviour. updatePassword and /reset-password both check only "is there a
    // user", never that the session came from a RECOVERY link -- so a normally signed-in user
    // (or anyone holding a stolen session cookie) can set a new password without proving they
    // know the current one. 5 lists "changing your password while logged in" as OPEN and NOT
    // DESIGNED, specifically because it needs a current-password re-auth decision; this ships
    // the capability without that decision having been made.
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(user.email);
    await page.getByLabel("Password", { exact: true }).fill(OLD_PASSWORD);
    await page.getByRole("button", { name: "Log in" }).click();
    await page.waitForURL(/\/food/);

    await page.goto("/reset-password");
    await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
    await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByLabel("Confirm new password", { exact: true }).fill(NEW_PASSWORD);
    await page.getByRole("button", { name: "Set new password" }).click();
    await page.waitForURL(/\/login/);

    // THE FINDING: changed with no knowledge of the current password and no emailed link.
    expect(await passwordWorks(user.email, NEW_PASSWORD)).toBe(true);
    expect(await passwordWorks(user.email, OLD_PASSWORD)).toBe(false);
  });
});

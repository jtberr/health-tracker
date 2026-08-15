import { test, expect, type Page } from "@playwright/test";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";

/**
 * QA-REVIEWER independent Phase 8l acceptance suite -- "The auth screens get the app's name back".
 *
 * Written from docs/architecture/food-weight-tracker.md 3.4 (the Phase 8l block), 6's
 * "Auth-screen identity" rows and 8 Phase 8l's own In/Out scope -- NOT from the developer's
 * implementation or their own Wordmark component test, which were read only afterwards.
 *
 * The zero-decorative-svg assertion here is deliberately implemented INDEPENDENTLY of
 * visual-identity-acceptance.spec.ts's own appSvgs() helper, rather than importing/reusing it:
 * 8l's requirement is that the Phase 8i guard keeps passing UNEDITED, so re-deriving the check
 * from the spec (rather than from the helper the guard happens to use) is the point.
 */

let user: TestUser;

test.beforeAll(async () => {
  user = await createConfirmedTestUser();
});

test.afterAll(async () => {
  if (user) await deleteTestUser(user.id);
});

const AUTH_PAGES = ["/login", "/signup"];

/**
 * Every <svg> the APP owns on this page. The Next.js dev-mode indicator injects its own badge
 * (a portal outside #__next / inside nextjs-portal), which is tooling, not app markup -- excluded
 * by element provenance, deliberately NOT by "is it aria-hidden inside a button", so this check
 * cannot be satisfied by a decorative graphic that merely happens to sit inside a control.
 */
async function appOwnedSvgs(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("svg"))
      .filter((s) => !s.closest("nextjs-portal") && !s.closest("[data-nextjs-toast]"))
      .map((s) => ({
        cls: s.getAttribute("class") || "",
        inButton: Boolean(s.closest("button")),
        html: (s.outerHTML || "").slice(0, 120),
      })),
  );
}

test.describe("Phase 8l -- the app names itself on its first screen", () => {
  for (const path of AUTH_PAGES) {
    test("the rendered text 'Health Tracker' is present on " + path, async ({ page }) => {
      await page.goto(path);
      // Asserted on RENDERED TEXT, not a component name -- and normalized, since the wordmark is
      // deliberately split across two <span>s so the two words can be coloured independently.
      const bodyText = await page.evaluate(() => (document.body.innerText || "").replace(/\s+/g, " "));
      expect(bodyText, "the app names itself on " + path).toContain("Health Tracker");
    });

    test("the tagline is present on " + path, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByText("Log food, weight and body fat in seconds.")).toBeVisible();
    });

    test("no app-owned decorative <svg> crept back onto " + path, async ({ page }) => {
      await page.goto(path);
      const svgs = await appOwnedSvgs(page);
      expect(svgs, "zero app-owned <svg> on " + path + ": " + JSON.stringify(svgs)).toHaveLength(0);
    });

    test("the wordmark is on-palette (--ink / --accent) and the page is still --canvas on " + path, async ({ page }) => {
      await page.goto(path);
      const colours = await page.evaluate(() => {
        const spans = Array.from(document.querySelectorAll("span"));
        const health = spans.find((s) => (s.textContent || "").trim() === "Health");
        const tracker = spans.find((s) => (s.textContent || "").trim() === "Tracker");
        return {
          health: health ? getComputedStyle(health).color : null,
          tracker: tracker ? getComputedStyle(tracker).color : null,
        };
      });
      expect(colours.health, "'Health' is --ink #0F172A").toBe("rgb(15, 23, 42)");
      expect(colours.tracker, "'Tracker' is --accent #1D4ED8").toBe("rgb(29, 78, 216)");

      // The page background is still --canvas -- folded in so the old palette cannot return
      // through the one screen the visual-identity suite covers most lightly.
      const canvas = await page.evaluate(() => {
        const el = document.querySelector(".bg-canvas");
        return el ? getComputedStyle(el).backgroundColor : null;
      });
      expect(canvas, "--canvas #F1F5F9").toBe("rgb(241, 245, 249)");
    });
  }
});

test.describe("Phase 8l -- one wordmark, two places, and nothing else moved", () => {
  test("the authenticated header link's accessible name is EXACTLY 'Health Tracker'", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(user.email);
    await page.getByLabel("Password").fill(user.password);
    await page.getByRole("button", { name: "Log in" }).click();
    await expect(page).toHaveURL("/food");

    // The invariant that keeps a two-tone/<span>-split implementation from changing the link's
    // name or breaking existing navigation.
    const link = page.getByRole("link", { name: "Health Tracker", exact: true });
    await expect(link).toHaveCount(1);
    await expect(link).toBeVisible();

    // No aria-label anywhere on or inside it -- an aria-label would silently override the name
    // for every consumer of the shared component.
    const labels = await link.evaluate((el) => ({
      own: el.getAttribute("aria-label"),
      descendants: Array.from(el.querySelectorAll("[aria-label]")).length,
    }));
    expect(labels.own).toBeNull();
    expect(labels.descendants).toBe(0);

    // ...and it still navigates (href="/", which Phase 8h redirects to /food).
    await page.goto("/settings");
    await page.getByRole("link", { name: "Health Tracker", exact: true }).click();
    await expect(page).toHaveURL("/food");
  });

  test("nothing other suites key off has moved on /login", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Log in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Log in", exact: true })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
  });

  test("nothing other suites key off has moved on /signup", async ({ page }) => {
    await page.goto("/signup");
    await expect(page.getByRole("heading", { level: 1, name: "Create your account" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign up", exact: true })).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
  });

  // The developer reports a real bug found during their own verification: shadow-lg passed via
  // className was silently overridden by Card's own baked-in shadow-sm, because Tailwind v4 emits
  // utility CSS in alphabetically-sorted class-name order (.shadow-lg before .shadow-sm), not JSX
  // attribute order. Verified here against the COMPUTED style, which is the only thing that
  // settles it -- a class-name assertion would have passed even with the bug present.
  test("the auth card really renders shadow-lg, not Card's own shadow-sm", async ({ page }) => {
    await page.goto("/login");
    const shadow = await page.evaluate(() => {
      const form = document.querySelector("form");
      const card = form ? form.closest("div.rounded-xl") : null;
      return card ? getComputedStyle(card).boxShadow : null;
    });
    expect(shadow, "the auth card has a computed box-shadow").toBeTruthy();
    // shadow-lg = 0 10px 15px -3px + 0 4px 6px -4px;  shadow-sm = 0 1px 3px 0 + 0 1px 2px -1px.
    expect(shadow, "shadow-lg's 10px/15px blur, not shadow-sm's 1px/3px: " + shadow).toContain("10px 15px");
    expect(shadow, "must NOT be Card's own shadow-sm").not.toContain("1px 3px 0px");
  });
});

test.describe("Phase 8l -- scope guard: Phase 8m was NOT started", () => {
  test("no /forgot-password or /reset-password route exists yet", async ({ page }) => {
    for (const path of ["/forgot-password", "/reset-password"]) {
      const res = await page.goto(path);
      expect(res, "a response for " + path).not.toBeNull();
      expect(res!.status(), path + " must still be 404 -- Phase 8m is a separate phase").toBe(404);
    }
  });

  test("/login carries no 'Forgot password?' link yet", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("link", { name: /forgot/i })).toHaveCount(0);
  });
});

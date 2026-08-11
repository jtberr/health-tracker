import { test, expect, type Page } from "@playwright/test";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";

/**
 * Independent acceptance tests for "Visual identity v2" (Phase 8i, 2026-08-09/10 —
 * ai-context/DECISIONS.md's "Visual identity v2: cool canvas, blue/orange accents, Geist-only,
 * rounded-rectangle actions..." entry; docs/architecture/food-weight-tracker.md §3.4/§6 "Visual
 * identity v2").
 *
 * REWRITTEN IN PLACE, per the design doc's explicit instruction — this file previously pinned the
 * OLD (2026-07-25) warm-paper + sage/clay identity, which Phase 8i deliberately reverses. Every
 * assertion below is now against the NEW identity. This is the fifth consecutive phase to carry
 * this "an existing suite pins something a new phase reverses" requirement.
 *
 * Method is unchanged from the original file, and is still the right one: assert on *computed*
 * styles in a real browser, never on source class names, because a class name in the source proves
 * nothing if the Tailwind utility was never generated.
 */

const EXPECT = {
  canvas: "rgb(241, 245, 249)", // --canvas #F1F5F9
  ink: "rgb(15, 23, 42)", // --ink    #0F172A
  accent: "rgb(29, 78, 216)", // --accent #1D4ED8
  accentSoft: "rgb(219, 234, 254)", // --accent-soft #DBEAFE
  white: "rgb(255, 255, 255)", // --surface #FFFFFF (a real Tailwind `white`, same value)
};

/** DECORATIVE SVGs in the app's own light DOM only — `page.locator` pierces shadow DOM and would
 *  also count Next.js's dev-overlay indicator, which is not app code.
 *
 *  Fixed (Phase 8k): the old sage-arc motif this test was written to catch was a free-standing,
 *  absolutely-positioned backdrop element with no enclosing interactive control — that is the
 *  actual thing "decorative" means here. It is NOT the same thing as this app's now-established
 *  icon-button vocabulary (`RepeatIcon`/`PencilIcon`/`TrashIcon`/`PinIcon`/`ChevronDownIcon`, incl.
 *  `DisclosureButton`'s chevron, Phase 8d-8k) — every one of those glyphs is `aria-hidden="true"`
 *  and lives inside a real `<button>`, per `ui/icons.tsx`'s own documented convention. Excluding
 *  exactly that shape (aria-hidden AND inside a button) keeps this test doing what its name says —
 *  "no arc anywhere" — without flagging every legitimate functional icon this app has shipped since
 *  the phase this file was last touched. A genuinely stray decorative element (an arc-like backdrop
 *  reintroduced outside a button) would still be caught. */
async function appSvgs(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("svg"))
      .filter((s) => !(s.getAttribute("aria-hidden") === "true" && s.closest("button")))
      .map((s) => ({
        color: getComputedStyle(s).color,
        hidden: s.getAttribute("aria-hidden"),
        cls: s.getAttribute("class") ?? "",
      }))
  );
}

/** Standard WCAG relative-luminance contrast ratio between two `rgb(r, g, b)` strings. */
function contrastRatio(rgbA: string, rgbB: string): number {
  function relLuminance(rgb: string): number {
    const [r, g, b] = rgb
      .replace(/rgba?\(|\)/g, "")
      .split(",")
      .map((n) => Number(n.trim()) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const lA = relLuminance(rgbA) + 0.05;
  const lB = relLuminance(rgbB) + 0.05;
  return lA > lB ? lA / lB : lB / lA;
}

let user: TestUser;
test.beforeAll(async () => {
  user = await createConfirmedTestUser();
});
test.afterAll(async () => {
  await deleteTestUser(user.id);
});

async function logIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/food");
}

test("the tokens actually compute, and type/shape rules hold, on the login page", async ({ page }) => {
  await page.goto("/login");

  // The canvas/surface tokens actually compute -- a token defined in :root but never wired into
  // @theme inline would produce a class that does nothing and a page that silently falls back.
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(EXPECT.canvas);
  const cardBg = await page
    .locator("div.rounded-xl")
    .first()
    .evaluate((e) => getComputedStyle(e).backgroundColor);
  expect(cardBg).toBe(EXPECT.white);

  // No serif anywhere: every heading resolves to a font-family containing "inter" and NOT
  // "fraunces" -- the font is genuinely un-registered, not merely unused.
  const h1Font = await page.locator("h1").evaluate((e) => getComputedStyle(e).fontFamily);
  expect(h1Font.toLowerCase()).toContain("inter");
  expect(h1Font.toLowerCase()).not.toContain("fraunces");

  const labelFont = await page
    .getByText("Email", { exact: true })
    .evaluate((e) => getComputedStyle(e).fontFamily);
  expect(labelFont.toLowerCase()).toContain("inter");
  expect(labelFont.toLowerCase()).not.toContain("fraunces");

  // document.fonts carries no Fraunces face at all.
  const fontFamilies = await page.evaluate(() =>
    Array.from(document.fonts).map((f) => f.family.toLowerCase())
  );
  expect(fontFamilies.some((f) => f.includes("fraunces"))).toBe(false);

  // Shape, both halves: the primary Button is a rounded RECTANGLE (~8px), NOT a surviving pill.
  const btn = await page.getByRole("button", { name: "Log in" }).evaluate((e) => {
    const c = getComputedStyle(e);
    return { bg: c.backgroundColor, fg: c.color, r: parseFloat(c.borderRadius) };
  });
  expect(btn.bg).toBe(EXPECT.accent);
  expect(btn.fg).toBe(EXPECT.white);
  expect(btn.r).toBeGreaterThan(4);
  expect(btn.r).toBeLessThan(16);

  // Card = rounded-xl (12px), down from the old rounded-2xl (16px).
  expect(
    await page.locator("div.rounded-xl").first().evaluate((e) => getComputedStyle(e).borderRadius),
  ).toBe("12px");

  // Links use --accent (never bare, unlabelled colour).
  expect(await page.getByRole("link", { name: "Sign up" }).evaluate((e) => getComputedStyle(e).color)).toBe(
    EXPECT.accent,
  );
});

test("the active NavLink is a surviving PILL (rounded-full) -- a blind find-replace of rounded-full would have taken it too", async ({
  page,
}) => {
  await logIn(page);
  await page.goto("/food");
  const nav = await page.getByRole("link", { name: "Food", exact: true }).evaluate((e) => {
    const c = getComputedStyle(e);
    return { bg: c.backgroundColor, fg: c.color, r: parseFloat(c.borderRadius) };
  });
  expect(nav.bg).toBe(EXPECT.accentSoft);
  expect(nav.fg).toBe(EXPECT.ink);
  expect(nav.r).toBeGreaterThan(500); // rounded-full
});

test("the Button secondary-variant SC 1.4.11 border defect is fixed: its border is >=3:1 against its own white fill", async ({
  page,
}) => {
  await logIn(page);
  await page.goto("/food");
  // "Log a saved meal" is a secondary-variant Button, always rendered by LogMealDialog's
  // collapsed picker-mode trigger regardless of whether the day has any entries -- unlike "Copy
  // this day"/"Select entries", which are conditionally hidden on an empty day. Waited for
  // (toBeVisible, not a synchronous .count()) since FoodDayView renders a client-only mount-Effect
  // "Loading…" placeholder before this button exists.
  const trigger = page.getByRole("button", { name: "Log a saved meal" });
  await expect(trigger).toBeVisible();
  const borderColor = await trigger.evaluate((e) => getComputedStyle(e).borderTopColor);
  // Compute the ratio in the test rather than string-matching the hex, so the assertion states the
  // REQUIREMENT (>=3:1 non-text/UI-component threshold), not just today's answer.
  expect(contrastRatio(borderColor, EXPECT.white)).toBeGreaterThanOrEqual(3);
});

test("contrast spot-checks on the combos that have historically failed here", async ({ page }) => {
  await logIn(page);

  // Active NavLink: --ink on --accent-soft.
  await page.goto("/food");
  const navRatio = contrastRatio(EXPECT.ink, EXPECT.accentSoft);
  expect(navRatio).toBeGreaterThanOrEqual(4.5);

  // Links/focus text on --canvas: the "Sign up"/"Log in" style accent link, sampled from a real
  // rendered link on an authenticated screen (the wordmark links elsewhere; use a settings link).
  await page.goto("/settings");
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(contrastRatio(EXPECT.accent, bodyBg)).toBeGreaterThanOrEqual(4.5);

  // Caption text (--muted) on both surfaces used across the app.
  const mutedOnCanvas = contrastRatio("rgb(71, 85, 105)", EXPECT.canvas);
  const mutedOnWhite = contrastRatio("rgb(71, 85, 105)", EXPECT.white);
  expect(mutedOnCanvas).toBeGreaterThanOrEqual(4.5);
  expect(mutedOnWhite).toBeGreaterThanOrEqual(4.5);
});

test("the sage arc is gone from every screen, including the auth screens it used to own", async ({ page }) => {
  for (const path of ["/login", "/signup"]) {
    await page.goto(path);
    const arcs = await appSvgs(page);
    expect(arcs, `no app-owned decorative <svg> on ${path}`).toHaveLength(0);
  }

  await logIn(page);
  for (const path of ["/food", "/meals", "/metrics", "/settings", "/trends"]) {
    await page.goto(path);
    await page.waitForTimeout(500);
    expect(await appSvgs(page), `no arc anywhere on ${path}`).toHaveLength(0);
  }
});

test("no stray old-palette (sage/clay/paper) computed colors anywhere, on any screen", async ({ page }) => {
  const OLD: Record<string, string> = {
    "rgb(251, 248, 241)": "--paper #FBF8F1",
    "rgb(92, 116, 68)": "--sage-deep #5C7444",
    "rgb(227, 234, 214)": "--sage-pale #E3EAD6",
    "rgb(169, 190, 140)": "--sage #A9BE8C",
    "rgb(201, 116, 82)": "--clay #C97452",
    "rgb(35, 33, 28)": "--ink (old) #23211C",
    // The old warm-neutral family this round replaces (a representative sample, not exhaustive).
    "rgb(231, 229, 228)": "stone-200",
    "rgb(120, 113, 108)": "stone-500",
  };
  const publicPaths = ["/login", "/signup"];
  for (const path of publicPaths) {
    await page.goto(path);
    expect(await scan(page, OLD), `stray old palette on ${path}`).toEqual([]);
  }
  await logIn(page);
  for (const path of ["/food", "/meals", "/metrics", "/settings", "/trends"]) {
    await page.goto(path);
    await page.waitForTimeout(500);
    expect(await scan(page, OLD), `stray old palette on ${path}`).toEqual([]);
  }
});

async function scan(page: Page, OLD: Record<string, string>) {
  return page.evaluate((OLD: Record<string, string>) => {
    const out: string[] = [];
    document.querySelectorAll("*").forEach((el) => {
      const c = getComputedStyle(el);
      for (const prop of ["color", "backgroundColor", "borderTopColor", "outlineColor"] as const) {
        const v = c[prop];
        if (OLD[v]) out.push(`<${el.tagName.toLowerCase()}> ${prop}=${OLD[v]}`);
      }
    });
    return out;
  }, OLD);
}

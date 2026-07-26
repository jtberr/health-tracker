import { test, expect, type Page } from "@playwright/test";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";

/**
 * Independent acceptance tests for the cross-cutting "visual identity rollout"
 * (ai-context/DECISIONS.md 2026-07-25 x2 + 2026-07-26 arc supersession;
 * docs/architecture/food-weight-tracker.md §8 "Visual identity rollout").
 *
 * Written by qa-reviewer against the DECISIONS/design-doc spec, not against the implementation.
 * These assert on *computed* styles in a real browser rather than on source class names, because a
 * class name in the source proves nothing if the Tailwind utility was never generated.
 */

const EXPECT = {
  paper: "rgb(251, 248, 241)", // --paper  #FBF8F1
  ink: "rgb(35, 33, 28)", // --ink    #23211C
  sage: "rgb(169, 190, 140)", // --sage   #A9BE8C
  sageDeep: "rgb(92, 116, 68)", // --sage-deep #5C7444
  sagePale: "rgb(227, 234, 214)", // --sage-pale #E3EAD6
};

/** SVGs in the app's own light DOM only — `page.locator` pierces shadow DOM and would also count
 *  Next.js's dev-overlay indicator, which is not app code. */
async function appSvgs(page: Page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("svg")).map((s) => ({
      color: getComputedStyle(s).color,
      hidden: s.getAttribute("aria-hidden"),
      cls: s.getAttribute("class") ?? "",
    }))
  );
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
  await expect(page).toHaveURL("/");
}

test("tokens actually compute, and type/shape rules hold, on the login page", async ({ page }) => {
  await page.goto("/login");

  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(EXPECT.paper);

  // Fraunces for headings...
  const h1Font = await page.locator("h1").evaluate((e) => getComputedStyle(e).fontFamily);
  expect(h1Font.toLowerCase()).toContain("fraunces");

  // ...Geist (NOT Fraunces) for body/UI text.
  const labelFont = await page
    .getByText("Email", { exact: true })
    .evaluate((e) => getComputedStyle(e).fontFamily);
  expect(labelFont.toLowerCase()).toContain("geist");
  expect(labelFont.toLowerCase()).not.toContain("fraunces");

  // primary Button = ink fill, paper label, pill shape
  const btn = await page.getByRole("button", { name: "Log in" }).evaluate((e) => {
    const c = getComputedStyle(e);
    return { bg: c.backgroundColor, fg: c.color, r: parseFloat(c.borderRadius) };
  });
  expect(btn.bg).toBe(EXPECT.ink);
  expect(btn.fg).toBe(EXPECT.paper);
  expect(btn.r).toBeGreaterThan(500); // rounded-full

  // Card = rounded-2xl (16px)
  expect(await page.locator("div.rounded-2xl").first().evaluate((e) => getComputedStyle(e).borderRadius)).toBe("16px");

  // links use sage-deep (4.9:1 on paper), never bare --sage
  expect(await page.getByRole("link", { name: "Sign up" }).evaluate((e) => getComputedStyle(e).color)).toBe(
    EXPECT.sageDeep
  );
});

test("the sage arc appears exactly once on each auth screen, decoratively", async ({ page }) => {
  for (const path of ["/login", "/signup"]) {
    await page.goto(path);
    const arcs = await appSvgs(page);
    expect(arcs, `arc count on ${path}`).toHaveLength(1);
    expect(arcs[0].color).toBe(EXPECT.sage); // --sage is fill/stroke only, never text
    expect(arcs[0].hidden).toBe("true"); // decorative => hidden from a11y tree
  }
});

test("the sage arc is NOT on the dashboard or any app screen (2026-07-26 supersession)", async ({ page }) => {
  await logIn(page);
  for (const path of ["/", "/food", "/metrics", "/settings", "/trends"]) {
    await page.goto(path);
    await page.waitForTimeout(800);
    expect(await appSvgs(page), `arc must not appear on ${path}`).toHaveLength(0);
  }
});

test("active NavLink is ink-on-sage-pale (the documented contrast trap), not sage-deep", async ({ page }) => {
  await logIn(page);
  for (const [path, label] of [
    ["/food", "Food"],
    ["/metrics", "Weight"],
    ["/trends", "Trends"],
    ["/settings", "Settings"],
  ] as const) {
    await page.goto(path);
    const s = await page.getByRole("link", { name: label, exact: true }).evaluate((e) => {
      const c = getComputedStyle(e);
      return { bg: c.backgroundColor, fg: c.color };
    });
    expect(s.bg, `${label} active bg`).toBe(EXPECT.sagePale);
    expect(s.fg, `${label} active fg`).toBe(EXPECT.ink); // NOT sage-deep (~4.2:1, under AA)
  }
});

test("no stray old-palette (indigo/emerald/zinc-900) computed colors on any screen", async ({ page }) => {
  const OLD: Record<string, string> = {
    "rgb(79, 70, 229)": "indigo-600",
    "rgb(99, 102, 241)": "indigo-500",
    "rgb(67, 56, 202)": "indigo-700",
    "rgb(238, 242, 255)": "indigo-50",
    "rgb(24, 24, 27)": "zinc-900",
    "rgb(236, 253, 245)": "emerald-50",
    "rgb(4, 120, 87)": "emerald-700",
  };
  await page.goto("/login");
  const publicPaths = ["/login", "/signup"];
  for (const path of publicPaths) {
    await page.goto(path);
    expect(await scan(page, OLD), `stray old palette on ${path}`).toEqual([]);
  }
  await logIn(page);
  for (const path of ["/", "/food", "/metrics", "/settings", "/trends"]) {
    await page.goto(path);
    await page.waitForTimeout(1000);
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

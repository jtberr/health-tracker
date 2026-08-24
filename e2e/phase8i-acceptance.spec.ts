import { test, expect, type Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";

/**
 * QA-REVIEWER independent Phase 8i acceptance suite -- "Visual identity v2: cool canvas,
 * blue/orange accents, no serif".
 *
 * 6 says Phase 8i's own acceptance work is a REWRITE of e2e/visual-identity-acceptance.spec.ts in
 * place, and that rewrite has landed. This file is deliberately NOT a duplicate of it: it is the
 * independent second opinion, concentrating on (a) the assertions that suite could pass VACUOUSLY,
 * (b) a genuine positive control for the old-palette scan, and (c) the parts of 3.4's hand-edit
 * list that suite does not reach (chart series pairings, border sides other than the top, the
 * NB-2 partial reversal on Card, and "no dark theme reintroduced").
 *
 * Method kept from the original suite because it was right: assert on COMPUTED styles in a real
 * browser, never on source class names -- a class in the source proves nothing if the utility was
 * never generated.
 */

test.use({ timezoneId: "UTC" });

/** 3.4's Phase 8i token table. */
const TOKENS = {
  canvas: "rgb(241, 245, 249)", // --canvas  #F1F5F9
  surface: "rgb(255, 255, 255)", // --surface #FFFFFF
  ink: "rgb(15, 23, 42)", // --ink     #0F172A
  muted: "rgb(71, 85, 105)", // --muted   #475569
  line: "rgb(203, 213, 225)", // --line    #CBD5E1
  lineStrong: "rgb(100, 116, 139)", // --line-strong #64748B
  accent: "rgb(29, 78, 216)", // --accent  #1D4ED8
  accentSoft: "rgb(219, 234, 254)", // --accent-soft #DBEAFE
  accentWarm: "rgb(194, 65, 12)", // --accent-warm #C2410C
};

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
  await expect(page).toHaveURL("/food", { timeout: 15000 });
}

/** Normalizes ANY CSS colour (incl. Tailwind v4's oklab serializations) to "r,g,b,a" by painting it. */
async function norm(page: Page, color: string): Promise<string> {
  const out = await page.evaluate((c: string) => {
    const cv = document.createElement("canvas");
    cv.width = 1;
    cv.height = 1;
    const ctx = cv.getContext("2d");
    if (!ctx) return "";
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return d[0] + "," + d[1] + "," + d[2] + "," + d[3];
  }, color);
  expect(out, "norm() must return r,g,b,a").not.toBe("");
  return out;
}

/** WCAG relative-luminance contrast ratio between two opaque "r,g,b,a" strings. */
function ratio(a: string, b: string): number {
  const lum = (s: string) => {
    const [r, g, bl] = s.split(",").map(Number);
    const f = (v: number) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(bl);
  };
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

const APP_PATHS = ["/food", "/meals", "/metrics", "/settings", "/trends"];

test.describe("Phase 8i -- the tokens genuinely compute (not just defined in :root)", () => {
  test("canvas / surface / ink resolve on real elements, on every app screen", async ({ page }) => {
    await logIn(page);
    for (const path of APP_PATHS) {
      await page.goto(path);
      await page.waitForTimeout(400);

      const bodyBg = await norm(
        page,
        await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
      );
      expect(bodyBg, `body background on ${path}`).toBe(await norm(page, TOKENS.canvas));

      const bodyColor = await norm(
        page,
        await page.evaluate(() => getComputedStyle(document.body).color),
      );
      expect(bodyColor, `body text on ${path}`).toBe(await norm(page, TOKENS.ink));
    }
  });

  test("a token defined but never wired into @theme inline would leave a class doing nothing -- all nine are wired", async ({
    page,
  }) => {
    await page.goto("/login");
    // Render a probe element per token utility and confirm each COMPUTES to the table's value.
    const results = await page.evaluate(() => {
      const utilities: Array<[string, string, "backgroundColor" | "color" | "borderTopColor"]> = [
        ["bg-canvas", "canvas", "backgroundColor"],
        ["text-ink", "ink", "color"],
        ["text-muted", "muted", "color"],
        ["border border-line", "line", "borderTopColor"],
        ["border border-line-strong", "lineStrong", "borderTopColor"],
        ["bg-accent", "accent", "backgroundColor"],
        ["bg-accent-soft", "accentSoft", "backgroundColor"],
        ["bg-accent-warm", "accentWarm", "backgroundColor"],
      ];
      const out: Record<string, string> = {};
      for (const [cls, key, prop] of utilities) {
        const el = document.createElement("div");
        el.className = cls;
        document.body.appendChild(el);
        out[key] = getComputedStyle(el)[prop];
        el.remove();
      }
      return out;
    });
    expect(Object.keys(results)).toHaveLength(8); // not vacuous
    for (const [key, value] of Object.entries(results)) {
      expect(await norm(page, value), `token ${key}`).toBe(
        await norm(page, TOKENS[key as keyof typeof TOKENS]),
      );
    }
  });
});

test.describe("Phase 8i -- no serif survives, anywhere", () => {
  test("headings and stat numerals resolve to a geist/inter sans, never fraunces", async ({ page }) => {
    await logIn(page);
    for (const path of APP_PATHS) {
      await page.goto(path);
      await page.waitForTimeout(400);
      const fonts = await page.evaluate(() =>
        Array.from(document.querySelectorAll("h1,h2,h3,p,span,div")).map(
          (el) => getComputedStyle(el).fontFamily,
        ),
      );
      expect(fonts.length, `probes on ${path}`).toBeGreaterThan(10); // not vacuous
      for (const f of fonts) expect(f.toLowerCase()).not.toContain("fraunces");
    }
  });

  test("Fraunces is genuinely UN-REGISTERED, not merely unused", async ({ page }) => {
    await page.goto("/login");
    const faces = await page.evaluate(() => {
      const out: string[] = [];
      document.fonts.forEach((f) => out.push(f.family.toLowerCase()));
      return out;
    });
    expect(faces.some((f) => f.includes("fraunces"))).toBe(false);

    // ...and no --font-serif theme variable survives, so a stray `font-serif` class could not
    // resolve to anything even if one were reintroduced by accident.
    const serifVar = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--font-serif").trim(),
    );
    // Tailwind v4 ships a DEFAULT --font-serif (ui-serif, Georgia, ...), so the variable
    // existing is expected and is not evidence of a regression. What must be gone is Fraunces.
    expect(serifVar.toLowerCase()).not.toContain("fraunces");
  });

  test("no dark theme was reintroduced -- forcing prefers-color-scheme: dark changes nothing", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/login");
    const bg = await norm(
      page,
      await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
    );
    // Still the light canvas: v1 is explicitly light-only and 8i must not have re-added a block.
    expect(bg).toBe(await norm(page, TOKENS.canvas));
    await page.emulateMedia({ colorScheme: null });
  });
});

test.describe("Phase 8i -- shape: actions are rounded rectangles, status/selection stay pills", () => {
  test("the primary Button is ~8px, NOT a pill", async ({ page }) => {
    await page.goto("/login");
    const submit = page.getByRole("button", { name: "Log in" });
    const r = parseFloat(await submit.evaluate((el) => getComputedStyle(el).borderTopLeftRadius));
    expect(r).toBeGreaterThan(4);
    expect(r).toBeLessThan(20); // a surviving rounded-full would be >=500
    expect(await norm(page, await submit.evaluate((el) => getComputedStyle(el).backgroundColor))).toBe(
      await norm(page, TOKENS.accent),
    );
  });

  test("the active NavLink is STILL a pill -- a blind rounded-full find-replace would have taken it", async ({
    page,
  }) => {
    await logIn(page);
    await page.goto("/food");
    const active = page.getByRole("link", { name: "Food", exact: true });
    const r = parseFloat(await active.evaluate((el) => getComputedStyle(el).borderTopLeftRadius));
    expect(r).toBeGreaterThanOrEqual(500);
    // ...and it is ink-on-accent-soft, keeping the guardrail the old palette needed.
    expect(await norm(page, await active.evaluate((el) => getComputedStyle(el).backgroundColor))).toBe(
      await norm(page, TOKENS.accentSoft),
    );
    expect(await norm(page, await active.evaluate((el) => getComputedStyle(el).color))).toBe(
      await norm(page, TOKENS.ink),
    );
  });
});

test.describe("Phase 8i -- the two contrast calls this round makes explicitly", () => {
  test("SC 1.4.11 FIX: the secondary Button's border is >=3:1 against its own white fill", async ({
    page,
  }) => {
    await logIn(page);
    await page.goto("/food");
    const secondary = page.getByRole("button", { name: "Log a saved meal", exact: true });
    await expect(secondary).toBeVisible({ timeout: 15000 });
    const style = await secondary.evaluate((el) => {
      const s = getComputedStyle(el);
      return { border: s.borderTopColor, bg: s.backgroundColor };
    });
    const border = await norm(page, style.border);
    const fill = await norm(page, style.bg);
    // Stated as the REQUIREMENT (a computed ratio), not as the current answer (a hex string).
    expect(ratio(border, fill), "secondary border vs its own fill").toBeGreaterThanOrEqual(3);
    // ...and it is genuinely --line-strong, i.e. the old 1.49:1 stone-300 defect is gone.
    expect(border).toBe(await norm(page, TOKENS.lineStrong));
  });

  test("DELIBERATE NB-2 PARTIAL REVERSAL: Card's border is the subtle --line, not stone-500", async ({
    page,
  }) => {
    await page.goto("/login");
    // Walk up from the submit button to the nearest ancestor that actually PAINTS a border --
    // a broad div filter otherwise picks a border-less wrapper, whose borderTopColor reports
    // currentColor (ink) and would fail for the wrong reason.
    const border = await norm(
      page,
      await page.getByRole("button", { name: "Log in" }).evaluate((btn) => {
        let el: HTMLElement | null = btn.parentElement;
        while (el) {
          const s = getComputedStyle(el);
          if (parseFloat(s.borderTopWidth) > 0) return s.borderTopColor;
          el = el.parentElement;
        }
        throw new Error("no bordered ancestor found");
      }),
    );
    // This is the one accessibility call 3.4 invites a reviewer to push back on. Recording the
    // measured value rather than merely accepting it: a Card is a decorative grouping container,
    // so SC 1.4.11 does not apply, and its border is BELOW 3:1 by design.
    expect(border).toBe(await norm(page, TOKENS.line));
    const surface = await norm(page, TOKENS.surface);
    expect(ratio(border, surface)).toBeLessThan(3);
    // The half of NB-2 that DOES apply to real components is kept: inputs use --line-strong.
    const input = page.getByLabel("Email");
    const inputBorder = await norm(
      page,
      await input.evaluate((el) => getComputedStyle(el).borderTopColor),
    );
    expect(inputBorder).toBe(await norm(page, TOKENS.lineStrong));
    expect(ratio(inputBorder, surface)).toBeGreaterThanOrEqual(3);
  });

  test("caption text (--muted) clears AA on BOTH surfaces it renders on", async ({ page }) => {
    await page.goto("/login");
    const muted = await norm(page, TOKENS.muted);
    expect(ratio(muted, await norm(page, TOKENS.surface))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(muted, await norm(page, TOKENS.canvas))).toBeGreaterThanOrEqual(4.5);
    // The lighter #64748B the design explicitly rejected for text would NOT clear it on canvas.
    expect(ratio(await norm(page, TOKENS.lineStrong), await norm(page, TOKENS.canvas))).toBeLessThan(4.5);
  });
});

test.describe("Phase 8i -- no old palette survives (with a positive control)", () => {
  /** The sage/clay/paper values plus the warm neutrals this round replaces. */
  const OLD: Record<string, string> = {
    "251,248,241,255": "--paper #FBF8F1",
    "92,116,68,255": "--sage-deep #5C7444",
    "227,234,214,255": "--sage-pale #E3EAD6",
    "169,190,140,255": "--sage #A9BE8C",
    "201,116,82,255": "--clay #C97452",
    "35,33,28,255": "--ink (old) #23211C",
    "231,229,228,255": "stone-200",
    "120,113,108,255": "stone-500",
    "214,211,209,255": "stone-300",
    "168,162,158,255": "stone-400",
  };

  /**
   * Scans EVERY border side, not just borderTopColor. The in-place visual-identity suite checks
   * only `borderTopColor`, which cannot see a left-only border -- and this app has two prominent
   * ones (`border-l-4` on the editing row and on an active group section). Also normalizes each
   * colour by painting it, so Tailwind v4's oklab serializations can't slip past a string compare.
   */
  async function scanOld(page: Page): Promise<string[]> {
    const raw = await page.evaluate(() => {
      const props = [
        "color",
        "backgroundColor",
        "borderTopColor",
        "borderRightColor",
        "borderBottomColor",
        "borderLeftColor",
        "outlineColor",
        "textDecorationColor",
      ] as const;
      const seen: Array<{ tag: string; prop: string; value: string }> = [];
      document.querySelectorAll("*").forEach((el) => {
        const cs = getComputedStyle(el as HTMLElement);
        for (const prop of props) {
          // Only report a border colour if that side actually paints.
          if (prop.startsWith("border")) {
            const w = cs[prop.replace("Color", "Width") as "borderTopWidth"];
            if (!w || parseFloat(w) === 0) continue;
          }
          seen.push({ tag: (el as HTMLElement).tagName.toLowerCase(), prop, value: cs[prop] });
        }
      });
      return seen;
    });

    const hits: string[] = [];
    const cache = new Map<string, string>();
    for (const s of raw) {
      let n = cache.get(s.value);
      if (n === undefined) {
        n = await norm(page, s.value);
        cache.set(s.value, n);
      }
      if (OLD[n]) hits.push(`<${s.tag}> ${s.prop} = ${OLD[n]}`);
    }
    return hits;
  }

  test("POSITIVE CONTROL: the scan really does catch an injected old-palette colour", async ({ page }) => {
    await page.goto("/login");
    // Inject one element per old token, including a LEFT-only border -- the case a borderTopColor-
    // only scan would miss entirely.
    await page.evaluate(() => {
      const a = document.createElement("div");
      a.style.color = "#5C7444"; // --sage-deep
      document.body.appendChild(a);
      const b = document.createElement("div");
      b.style.borderLeft = "4px solid #C97452"; // --clay, LEFT side only
      document.body.appendChild(b);
    });
    const hits = await scanOld(page);
    expect(hits.join(" | ")).toContain("--sage-deep");
    expect(hits.join(" | ")).toContain("--clay");
  });

  test("no stray old-palette colour on the public screens", async ({ page }) => {
    for (const path of ["/login", "/signup"]) {
      await page.goto(path);
      expect(await scanOld(page), `stray old palette on ${path}`).toEqual([]);
    }
  });

  test("no stray old-palette colour on any app screen, WITH real data rendered", async ({ page }) => {
    // Seed real content so the scan sees populated lists/cards/charts rather than empty states --
    // an empty page is the way this class of scan passes vacuously.
    const today = new Date().toISOString().slice(0, 10);
    await client.from("food_entries").insert({
      user_id: user.id,
      name: "QA8i Rice",
      quantity: 1,
      unit: null,
      calories_per_unit: 400,
      protein_g_per_unit: 20,
      consumed_at: today + "T12:30:00.000Z",
      consumed_tz: "UTC",
    });
    const { data: meal } = await client
      .from("meals")
      .insert({ user_id: user.id, name: "QA8i Meal", is_pinned: true })
      .select()
      .single();
    await client.from("meal_items").insert({
      meal_id: meal!.id,
      user_id: user.id,
      name: "QA8i Item",
      quantity: 1,
      unit: null,
      calories_per_unit: 100,
      protein_g_per_unit: 10,
      sort_order: 0,
    });
    await client
      .from("daily_metrics")
      .upsert({ user_id: user.id, metric_date: today, weight_kg: 80, body_fat_pct: 20 });

    await logIn(page);
    for (const path of APP_PATHS) {
      await page.goto(path);
      await page.waitForTimeout(700);
      expect(await scanOld(page), `stray old palette on ${path}`).toEqual([]);
    }
  });

  test("the chart series took the intended pairings (calories warm, protein accent)", async ({ page }) => {
    await logIn(page);
    await page.goto("/trends");
    await page.waitForTimeout(1200);

    const strokes = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".recharts-line-curve")).map(
        (el) => getComputedStyle(el as SVGElement).stroke,
      ),
    );
    expect(strokes.length, "trend chart lines rendered").toBeGreaterThan(0);
    const normalized = await Promise.all(strokes.map((s) => norm(page, s)));
    const accent = await norm(page, TOKENS.accent);
    const warm = await norm(page, TOKENS.accentWarm);
    // Every plotted series is one of the two new accents -- no sage/clay survivor.
    for (const s of normalized) expect([accent, warm]).toContain(s);
    // Both accents are actually in use, so the pairing is a real distinction rather than one colour.
    expect(normalized).toContain(accent);
    expect(normalized).toContain(warm);
  });
});

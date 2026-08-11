import { test, expect, type Page } from "@playwright/test";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";

// QA-REVIEWER independent Phase 4 acceptance suite. Written from the design doc spec
// (docs/architecture/food-weight-tracker.md section 8 Phase 4 + 3.2/3.4) and ai-context/DECISIONS.md
// ("Weight stored canonically in kg", "share one daily row", "single current goal",
// "No logging into the future" -- daily_metrics case). NOT derived from the developer's
// units.test.ts or any e2e the developer wrote.

async function logIn(page: Page, user: TestUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/food");
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

async function forceDatePicker(page: Page, value: string) {
  await page.locator("#metric-day").evaluate((el, v) => {
    const input = el as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test.describe("Phase4 QA metrics upsert (one row/day)", () => {
  let user: TestUser;
  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("weight-only entry stores exactly one row with body_fat_pct null", async ({ page }) => {
    await page.goto("/metrics");
    await expect(page.getByLabel(/^Weight/)).toBeVisible();
    await page.getByLabel(/^Weight/).fill("80");
    await page.getByRole("button", { name: "Log entry" }).click();
    await expect(page.getByText(/Already logged/)).toBeVisible();

    const client = await createUserClient(user);
    const res = await client.from("daily_metrics").select("weight_kg,body_fat_pct");
    expect(res.data ?? []).toHaveLength(1);
    expect(Number(res.data![0].weight_kg)).toBeCloseTo(80, 2);
    expect(res.data![0].body_fat_pct).toBeNull();
  });

  test("re-saving the same day overwrites -- does NOT create a second row", async ({ page }) => {
    await page.goto("/metrics");
    await expect(page.getByLabel(/^Weight/)).toBeVisible();
    await page.getByLabel(/^Weight/).fill("80");
    await page.getByLabel(/Body fat/).fill("20");
    await page.getByRole("button", { name: "Log entry" }).click();
    await expect(page.getByText(/Already logged/)).toBeVisible();

    await page.getByLabel(/^Weight/).fill("81.5");
    await page.getByLabel(/Body fat/).fill("18.5");
    await page.getByRole("button", { name: "Save changes" }).click();

    const client = await createUserClient(user);
    await expect
      .poll(async () => {
        const r = await client.from("daily_metrics").select("weight_kg");
        return Number((r.data ?? [{ weight_kg: 0 }])[0].weight_kg);
      })
      .toBeCloseTo(81.5, 1);
    const res = await client.from("daily_metrics").select("weight_kg,body_fat_pct");
    expect(res.data ?? []).toHaveLength(1);
    expect(Number(res.data![0].body_fat_pct)).toBeCloseTo(18.5, 1);
  });
});

test.describe("Phase4 QA unit preference end-to-end", () => {
  let user: TestUser;
  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("lb input is stored as canonical kg and survives a unit switch unchanged", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel(/Pounds/).check();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();

    await page.goto("/metrics");
    await expect(page.getByLabel(/^Weight \(lb\)/)).toBeVisible();
    await page.getByLabel(/^Weight/).fill("150");
    await page.getByRole("button", { name: "Log entry" }).click();
    await expect(page.getByText(/Already logged/)).toBeVisible();

    const client = await createUserClient(user);
    const stored = await client.from("daily_metrics").select("weight_kg").single();
    expect(Number(stored.data!.weight_kg)).toBeCloseTo(68.04, 2);

    await page.goto("/settings");
    await page.getByLabel(/Kilograms/).check();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();

    await page.goto("/metrics");
    await expect(page.getByLabel(/^Weight \(kg\)/)).toBeVisible();
    await expect(page.getByLabel(/^Weight/)).toHaveValue("68");

    const after = await client.from("daily_metrics").select("weight_kg");
    expect(after.data ?? []).toHaveLength(1);
    expect(Number(after.data![0].weight_kg)).toBeCloseTo(68.04, 2);
  });
});

test.describe("Phase4 QA goals CRUD + ensure-row", () => {
  let user: TestUser;
  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  // 2026-08-10 (Phase 8j, "Daily goal progress on /food"): `getGoals()`'s ensure-row upsert gained
  // a THIRD read-only caller, `/food` -- and this describe block's own shared `beforeEach` above
  // logs in via `logIn()`, which lands on `/food` (Phase 8h: `/` redirects there), not `/settings`.
  // So by the time this test's body runs, the default row has ALREADY been created by the login
  // step itself -- "before Settings, there are zero rows" is no longer true, and was never actually
  // the invariant worth proving; it was an artifact of `/settings` being the only ensure-row caller
  // at the time this test was written (see ai-context/DECISIONS.md's Phase 8j entry, which already
  // recorded this exact "ensure-row gains a caller" consequence as known and accepted). The real
  // invariant -- a fresh user's ensure-row default is correct (kg, both targets null) and visiting
  // `/settings` afterward is idempotent and never errors, regardless of WHICH screen created the
  // row first -- is unchanged and still proven below.
  test("the ensure-row default is correct (kg, no targets) and visiting Settings afterward is idempotent, never erroring", async ({
    page,
  }) => {
    const client = await createUserClient(user);
    const afterLogin = await client.from("user_goals").select("*");
    expect(afterLogin.data ?? []).toHaveLength(1);
    expect(afterLogin.data![0].weight_unit).toBe("kg");
    expect(afterLogin.data![0].daily_calorie_target).toBeNull();
    expect(afterLogin.data![0].daily_protein_target_g).toBeNull();

    await page.goto("/settings");
    await expect(page.getByRole("button", { name: "Save settings" })).toBeVisible();
    await expect(page.getByText(/Couldn.t load your settings/)).toHaveCount(0);
    await expect(page.getByLabel(/Kilograms/)).toBeChecked();
    await expect(page.getByLabel(/Daily calorie target/)).toHaveValue("");

    const after = await client.from("user_goals").select("*");
    expect(after.data ?? []).toHaveLength(1);
    expect(after.data![0].weight_unit).toBe("kg");
    expect(after.data![0].daily_calorie_target).toBeNull();
    expect(after.data![0].daily_protein_target_g).toBeNull();
  });

  test("updateGoals round-trips calorie/protein targets and the unit toggle", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel(/Daily calorie target/).fill("2200");
    await page.getByLabel(/Daily protein target/).fill("165");
    await page.getByLabel(/Pounds/).check();
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();

    const client = await createUserClient(user);
    const res = await client.from("user_goals").select("*").single();
    expect(res.data!.daily_calorie_target).toBe(2200);
    expect(Number(res.data!.daily_protein_target_g)).toBeCloseTo(165, 2);
    expect(res.data!.weight_unit).toBe("lb");

    await page.reload();
    await expect(page.getByLabel(/Daily calorie target/)).toHaveValue("2200");
    await expect(page.getByLabel(/Daily protein target/)).toHaveValue("165");
    await expect(page.getByLabel(/Pounds/)).toBeChecked();
  });

  test("still exactly one goals row after multiple saves (single current goal, no history)", async ({ page }) => {
    await page.goto("/settings");
    await page.getByLabel(/Daily calorie target/).fill("2000");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();
    await page.getByLabel(/Daily calorie target/).fill("2500");
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText("Settings saved.")).toBeVisible();

    const client = await createUserClient(user);
    await expect
      .poll(async () => {
        const r = await client.from("user_goals").select("daily_calorie_target").single();
        return r.data?.daily_calorie_target ?? null;
      })
      .toBe(2500);
    const res = await client.from("user_goals").select("*");
    expect(res.data ?? []).toHaveLength(1);
  });
});

test.describe("Phase4 QA no-future metric date (UTC browser)", () => {
  test.use({ timezoneId: "UTC" });
  let user: TestUser;
  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("tomorrow is rejected server-side and writes NO row -- even though the loose DB CHECK (current_date+1) would allow it", async ({ page }) => {
    await page.goto("/metrics");
    await expect(page.getByLabel(/^Weight/)).toBeVisible();
    await forceDatePicker(page, isoDaysFromNow(1));
    await expect(page.getByLabel(/^Weight/)).toBeVisible();
    await page.getByLabel(/^Weight/).fill("77");
    await page.getByRole("button", { name: "Log entry" }).click();

    await expect(page.getByText(/can.t log a metric dated later than today/i)).toBeVisible();
    const client = await createUserClient(user);
    const res = await client.from("daily_metrics").select("id");
    expect(res.data ?? []).toHaveLength(0);
  });
});

test.describe("Phase4 QA legit ahead-of-UTC today not falsely rejected", () => {
  test.use({ timezoneId: "Pacific/Kiritimati" });
  let user: TestUser;
  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("a UTC+14 user logging their own local today succeeds and stores that local date", async ({ page }) => {
    await page.goto("/metrics");
    await expect(page.getByLabel(/^Weight/)).toBeVisible();
    const localToday = await page.locator("#metric-day").inputValue();
    await page.getByLabel(/^Weight/).fill("75");
    await page.getByRole("button", { name: "Log entry" }).click();
    await expect(page.getByText(/Already logged/)).toBeVisible();

    const client = await createUserClient(user);
    const res = await client.from("daily_metrics").select("metric_date").single();
    expect(res.error).toBeNull();
    expect(res.data!.metric_date).toBe(localToday);
  });
});

test.describe("Phase4 QA cross-user isolation (metrics + goals)", () => {
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

  test("user B cannot read/update/delete user A daily_metrics row", async () => {
    const clientA = await createUserClient(userA);
    const ins = await clientA
      .from("daily_metrics")
      .insert({ user_id: userA.id, metric_date: "2026-07-10", weight_kg: 70 })
      .select()
      .single();
    expect(ins.error).toBeNull();
    const rowId = ins.data!.id as string;

    const clientB = await createUserClient(userB);
    expect((await clientB.from("daily_metrics").select("*").eq("id", rowId)).data ?? []).toHaveLength(0);
    expect((await clientB.from("daily_metrics").update({ weight_kg: 1 }).eq("id", rowId).select()).data ?? []).toHaveLength(0);
    expect((await clientB.from("daily_metrics").delete().eq("id", rowId).select()).data ?? []).toHaveLength(0);

    const readA = await clientA.from("daily_metrics").select("weight_kg").eq("id", rowId).single();
    expect(Number(readA.data!.weight_kg)).toBeCloseTo(70, 2);
  });

  test("user B cannot read/update/delete user A user_goals row", async () => {
    const clientA = await createUserClient(userA);
    const ins = await clientA
      .from("user_goals")
      .insert({ user_id: userA.id, daily_calorie_target: 1234, weight_unit: "kg" })
      .select()
      .single();
    expect(ins.error).toBeNull();

    const clientB = await createUserClient(userB);
    expect((await clientB.from("user_goals").select("*").eq("user_id", userA.id)).data ?? []).toHaveLength(0);
    expect((await clientB.from("user_goals").update({ daily_calorie_target: 9 }).eq("user_id", userA.id).select()).data ?? []).toHaveLength(0);
    expect((await clientB.from("user_goals").delete().eq("user_id", userA.id).select()).data ?? []).toHaveLength(0);

    const readA = await clientA.from("user_goals").select("daily_calorie_target").eq("user_id", userA.id).single();
    expect(readA.data!.daily_calorie_target).toBe(1234);
  });
});

import { test, expect, type Page } from "@playwright/test";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";

// QA-REVIEWER independent Phase 3 acceptance suite. Written from the design doc spec
// (docs/architecture/food-weight-tracker.md 2/3.4/6), NOT derived from food-logging.spec.ts.

async function logIn(page: Page, user: TestUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
}

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function at(day: string, hhmm: string): string {
  return day + "T" + hhmm + ":00Z";
}

test.describe("Phase3 QA grouping edge cases", () => {
  let user: TestUser;
  const day = "2026-07-12";
  test.beforeEach(async ({ page }) => { user = await createConfirmedTestUser(); await logIn(page, user); });
  test.afterEach(async () => { await deleteTestUser(user.id); });

  test("entries one minute apart do NOT group (exact-match, not a window)", async ({ page }) => {
    const client = await createUserClient(user);
    await client.from("food_entries").insert([
      { user_id: user.id, name: "ItemA", quantity: 1, calories_per_unit: 100, protein_g_per_unit: 5, consumed_at: at(day, "12:00"), consumed_tz: "UTC" },
      { user_id: user.id, name: "ItemB", quantity: 1, calories_per_unit: 100, protein_g_per_unit: 5, consumed_at: at(day, "12:01"), consumed_tz: "UTC" },
    ]);
    await page.goto("/food");
    await page.getByLabel("Day").fill(day);
    await expect(page.getByText("ItemA")).toBeVisible();
    await expect(page.locator("section")).toHaveCount(2);
  });

  test("every 30 minutes run yields one group per distinct instant", async ({ page }) => {
    const client = await createUserClient(user);
    const times = ["12:00", "12:30", "13:00", "13:30", "14:00"];
    const rows = times.map((t, i) => ({
      user_id: user.id, name: "Graze" + i, quantity: 1, calories_per_unit: 50, protein_g_per_unit: 2,
      consumed_at: at(day, t), consumed_tz: "UTC",
    }));
    await client.from("food_entries").insert(rows);
    await page.goto("/food");
    await page.getByLabel("Day").fill(day);
    await expect(page.getByText("Graze0")).toBeVisible();
    await expect(page.locator("section")).toHaveCount(5);
  });
});

test.describe("Phase3 QA ratio-of-sums correctness", () => {
  let user: TestUser;
  const day = "2026-07-13";
  test.beforeEach(async ({ page }) => { user = await createConfirmedTestUser(); await logIn(page, user); });
  test.afterEach(async () => { await deleteTestUser(user.id); });

  test("day pct is calorie-weighted ratio-of-sums, not the mean of per-entry pcts", async ({ page }) => {
    const client = await createUserClient(user);
    // 40g/100kcal => 160pct; 5g/900kcal => 2.2pct; mean=81.1pct; ratio-of-sums=(45*4)/1000*100=18pct.
    await client.from("food_entries").insert([
      { user_id: user.id, name: "ShakeExtreme", quantity: 1, calories_per_unit: 100, protein_g_per_unit: 40, consumed_at: at(day, "08:00"), consumed_tz: "UTC" },
      { user_id: user.id, name: "BigCarb", quantity: 1, calories_per_unit: 900, protein_g_per_unit: 5, consumed_at: at(day, "09:00"), consumed_tz: "UTC" },
    ]);
    await page.goto("/food");
    await page.getByLabel("Day").fill(day);
    await expect(page.getByText("ShakeExtreme")).toBeVisible();
    await expect(page.getByText("18%", { exact: true })).toBeVisible();
    await expect(page.getByText(/81/)).toHaveCount(0);
  });

  test("per-entry protein pct over 100 is shown as-is, not clamped", async ({ page }) => {
    const client = await createUserClient(user);
    await client.from("food_entries").insert([
      { user_id: user.id, name: "OverHundred", quantity: 1, calories_per_unit: 100, protein_g_per_unit: 30, consumed_at: at(day, "10:00"), consumed_tz: "UTC" },
    ]);
    await page.goto("/food");
    await page.getByLabel("Day").fill(day);
    await expect(page.locator("li", { hasText: "OverHundred" })).toContainText("120%");
  });
});

test.describe("Phase3 QA form flow, future cap, delete totals", () => {
  let user: TestUser;
  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
    await page.goto("/food");
    await expect(page.getByRole("heading", { name: "Food log" })).toBeVisible();
  });
  test.afterEach(async () => { await deleteTestUser(user.id); });

  test("future-day add is rejected AND writes no row to the DB", async ({ page }) => {
    await page.getByLabel("Name").fill("FutureFood");
    await page.getByLabel("Total calories").fill("50");
    await page.getByLabel("Total protein (g)").fill("2");
    await page.getByLabel("Date").fill(isoDaysFromNow(2));
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText(/log an entry dated later than today/i)).toBeVisible();
    const client = await createUserClient(user);
    const res = await client.from("food_entries").select("id");
    expect(res.data ?? []).toHaveLength(0);
  });

  test("off-grid time 12:07 is rejected server-side when the UI grid is bypassed", async ({ page }) => {
    await page.getByLabel("Name").fill("OffGrid");
    await page.getByLabel("Total calories").fill("100");
    await page.getByLabel("Total protein (g)").fill("5");
    await page.getByLabel("Time").evaluate((el) => { (el as HTMLInputElement).value = "12:07"; });
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText(/15-minute interval/i)).toBeVisible();
    const client = await createUserClient(user);
    const res = await client.from("food_entries").select("id");
    expect(res.data ?? []).toHaveLength(0);
  });

  test("per-unit mode totals equal quantity times per-unit, recalc on quantity edit", async ({ page }) => {
    await page.getByLabel("Name").fill("Almonds");
    await page.getByText("Add detail (quantity, unit)").click();
    await page.getByRole("spinbutton", { name: "Quantity" }).fill("3");
    await page.getByLabel("Unit (optional)").fill("handful");
    await page.getByRole("radio", { name: "Per unit" }).check();
    await page.getByLabel("Calories per unit").fill("100");
    await page.getByLabel("Protein per unit (g)").fill("4");
    await page.getByRole("button", { name: "Add entry" }).click();
    const row = page.locator("li", { hasText: "Almonds" });
    await expect(row).toContainText("300 kcal");
    await expect(row).toContainText("12g protein");
    await row.getByRole("button", { name: "Edit" }).click();
    await page.getByRole("spinbutton", { name: "Quantity" }).fill("5");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.locator("li", { hasText: "Almonds" })).toContainText("500 kcal");
    await expect(page.locator("li", { hasText: "Almonds" })).toContainText("20g protein");
  });

  test("delete decrements the day totals, not just the list", async ({ page }) => {
    await page.getByLabel("Name").fill("SnackOne");
    await page.getByLabel("Total calories").fill("300");
    await page.getByLabel("Total protein (g)").fill("10");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("SnackOne")).toBeVisible();
    await expect(page.getByText("300", { exact: true }).first()).toBeVisible();
    await page.locator("li", { hasText: "SnackOne" }).getByRole("button", { name: "Delete" }).click();
    await expect(page.getByText("SnackOne")).toHaveCount(0);
    await expect(page.locator("p", { hasText: /^0$/ }).first()).toBeVisible();
  });

  test("manual time override is respected (entry lands on the chosen 15-min bucket)", async ({ page }) => {
    // Backdate the entry within today to 12:30 (well outside the 120-min freshness window vs a
    // typical CI clock). Per spec the override is honored on the grid; whether a *later* add
    // inherits it depends on the freshness window (covered by the "moments later" grouping test),
    // so this asserts only the deterministic part: the chosen bucket is what gets stored/shown.
    await page.getByLabel("Name").fill("Lunch");
    await page.getByLabel("Total calories").fill("500");
    await page.getByLabel("Total protein (g)").fill("30");
    await page.getByLabel("Time").fill("12:30");
    await page.getByRole("button", { name: "Add entry" }).click();
    await expect(page.getByText("Lunch")).toBeVisible();
    const group = page.locator("section", { hasText: "Lunch" });
    await expect(group.locator("header")).toContainText("12:30");
    await expect(group.locator("header")).toContainText("500 kcal");
  });
});

test.describe("Phase3 QA tz-preserved-on-edit deviation 4", () => {
  test.use({ timezoneId: "America/New_York" });
  let user: TestUser;
  const tokyoInstant = "2026-07-15T02:00:00Z";
  const tokyoDay = "2026-07-15";
  test.beforeEach(async ({ page }) => { user = await createConfirmedTestUser(); await logIn(page, user); });
  test.afterEach(async () => { await deleteTestUser(user.id); });

  test("editing an entry name in a different browser tz does not move its instant or group", async ({ page }) => {
    const client = await createUserClient(user);
    await client.from("food_entries").insert([
      { user_id: user.id, name: "TokyoRice", quantity: 1, calories_per_unit: 200, protein_g_per_unit: 4, consumed_at: tokyoInstant, consumed_tz: "Asia/Tokyo" },
      { user_id: user.id, name: "TokyoFish", quantity: 1, calories_per_unit: 200, protein_g_per_unit: 36, consumed_at: tokyoInstant, consumed_tz: "Asia/Tokyo" },
    ]);
    await page.goto("/food");
    await page.getByLabel("Day").fill(tokyoDay);
    await expect(page.getByText("TokyoRice")).toBeVisible();
    await expect(page.locator("section")).toHaveCount(1);
    await page.locator("li", { hasText: "TokyoRice" }).getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Name").fill("TokyoRiceEdited");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("TokyoRiceEdited")).toBeVisible();
    await expect(page.locator("section")).toHaveCount(1);
    const res = await client.from("food_entries").select("consumed_at,consumed_tz,consumed_local_date").eq("name", "TokyoRiceEdited").single();
    expect(res.data?.consumed_tz).toBe("Asia/Tokyo");
    expect(res.data?.consumed_local_date).toBe(tokyoDay);
    expect(new Date(res.data!.consumed_at as string).toISOString()).toBe(new Date(tokyoInstant).toISOString());
  });
});

test.describe("Phase3 QA cross-user isolation via the action surface", () => {
  let userA: TestUser;
  let userB: TestUser;
  test.beforeEach(async () => { userA = await createConfirmedTestUser(); userB = await createConfirmedTestUser(); });
  test.afterEach(async () => { await deleteTestUser(userA.id); await deleteTestUser(userB.id); });

  test("user B cannot read, update, or delete user A food_entries row", async () => {
    const clientA = await createUserClient(userA);
    const ins = await clientA.from("food_entries").insert({ user_id: userA.id, name: "PrivateA", quantity: 1, calories_per_unit: 100, protein_g_per_unit: 5, consumed_at: "2026-07-11T12:00:00Z", consumed_tz: "UTC" }).select().single();
    expect(ins.error).toBeNull();
    const rowId = ins.data.id as string;
    const clientB = await createUserClient(userB);
    const readB = await clientB.from("food_entries").select("*").eq("id", rowId);
    expect(readB.data ?? []).toHaveLength(0);
    const updB = await clientB.from("food_entries").update({ name: "Hacked" }).eq("id", rowId).select();
    expect(updB.data ?? []).toHaveLength(0);
    const delB = await clientB.from("food_entries").delete().eq("id", rowId).select();
    expect(delB.data ?? []).toHaveLength(0);
    const readA = await clientA.from("food_entries").select("name").eq("id", rowId).single();
    expect(readA.data?.name).toBe("PrivateA");
  });
});

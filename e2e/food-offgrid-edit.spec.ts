import { test, expect, type Page } from "@playwright/test";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";

// An entry stored with an off-grid consumed_at (e.g. 09:07 local) must:
//  (a) display/select its exact off-grid value in the <select>, NOT silently fall back to the
//      first option (00:00), which would silently rewrite the time on the next save; and
//  (b) if submitted unchanged, must NOT be silently corrupted to a grid value / 12:00 AM.

async function logIn(page: Page, user: TestUser) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL("/");
}

test.describe("off-grid edit invariant", () => {
  test.use({ timezoneId: "UTC" });
  let user: TestUser;
  const day = "2026-07-12";
  const offGridInstant = `${day}T09:07:00Z`;

  test.beforeEach(async ({ page }) => {
    user = await createConfirmedTestUser();
    await logIn(page, user);
  });
  test.afterEach(async () => {
    await deleteTestUser(user.id);
  });

  test("off-grid stored time is preserved in the select and not silently corrupted on unchanged save", async ({ page }) => {
    const client = await createUserClient(user);
    const ins = await client
      .from("food_entries")
      .insert({
        user_id: user.id,
        name: "LegacyOffGrid",
        quantity: 1,
        calories_per_unit: 100,
        protein_g_per_unit: 5,
        consumed_at: offGridInstant,
        consumed_tz: "UTC",
      })
      .select()
      .single();
    expect(ins.error).toBeNull();

    await page.goto("/food");
    await page.getByLabel("Day").fill(day);
    await expect(page.getByText("LegacyOffGrid")).toBeVisible();

    await page.locator("li", { hasText: "LegacyOffGrid" }).getByRole("button", { name: "Edit" }).click();

    // (a) The select must show the exact off-grid value, not fall back to 00:00.
    const timeSelect = page.getByLabel("Time");
    await expect(timeSelect).toHaveValue("09:07");
    await expect(timeSelect.locator("option[value='09:07']")).toHaveCount(1);

    // Submit without touching the time. Change only the name so an update is genuinely attempted.
    await page.getByLabel("Name").fill("LegacyOffGridEdited");
    await page.getByRole("button", { name: "Save changes" }).click();

    // (b) Server rejects the off-grid time (15-minute rule) rather than persisting a corrupted value.
    await expect(page.getByText(/15-minute interval/i)).toBeVisible();

    // The stored row must be unchanged: same instant, and (because the update was rejected) the
    // name edit did not persist either. Crucially the time is NOT rewritten to 00:00 or a grid value.
    const row = await client
      .from("food_entries")
      .select("name,consumed_at")
      .eq("id", ins.data.id)
      .single();
    expect(new Date(row.data!.consumed_at as string).toISOString()).toBe(new Date(offGridInstant).toISOString());
    expect(row.data!.name).toBe("LegacyOffGrid");
  });
});

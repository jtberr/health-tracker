import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "../../../e2e/helpers/test-users";
import { createUserClient } from "../../../e2e/helpers/user-client";
import { createAdminClient } from "../../../e2e/helpers/admin-client";
import type { FoodEntry, Meal, MealItem } from "@/lib/types";

/**
 * Developer-owned integration tests for `src/lib/actions/meals.ts` (Phase 7 — "Saved meals"),
 * added per qa-reviewer's N-7 finding: this is the security-critical file in the phase (the
 * app-layer `logged_from_meal_id` ownership invariant — see the doc comment at the top of
 * `meals.ts` and ai-context/DECISIONS.md — is enforced here), and it shipped with zero direct
 * test coverage; only the pure domain helpers it calls into (`meal-items.ts`, `validation.ts`)
 * had unit tests. `e2e/phase7-acceptance.spec.ts` (qa-reviewer's own suite) already covers this
 * same behavior end-to-end through the browser/UI — this file is the missing complement: it
 * calls the Server Action *functions themselves* directly, against a real local
 * Postgres/Supabase instance with RLS enabled (not mocked), the same way `src/lib/actions/
 * auth.test.ts` unit-tests `lib/actions/auth.ts` — except there `createClient` is mocked with a
 * stub, and here it's mocked to return a REAL anon-key client already signed in as a specific
 * test user (`e2e/helpers/user-client.ts`), so `supabase.auth.getUser()` and every RLS-scoped
 * query below hit real Postgres, exactly like the app does in production.
 *
 * Also covers `createMealFromEntries` (Phase 7b — "Save a logged meal group as a Saved Meal"),
 * the exact mirror of `logMealForDay`: the same real-Postgres/RLS approach, now proving the
 * entries->meal direction's ownership re-check (a foreign or mixed-ownership entry id set is
 * rejected wholesale, writing zero rows anywhere) and its read-only-on-`food_entries` guarantee
 * (source rows byte-identical, including `updated_at` and `logged_from_meal_id`, before and after).
 *
 * Requires a running local Supabase instance and `NEXT_PUBLIC_SUPABASE_URL` /
 * `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` in the environment (see
 * .env.example; `vitest.config.ts` loads `.env.local` the same way `playwright.config.ts`
 * already does for e2e). When those aren't present — notably CI's "Unit tests" step, which
 * deliberately runs BEFORE the ephemeral Supabase stack is started (see
 * .github/workflows/ci.yml) — this whole suite skips itself cleanly via `describe.skipIf` rather
 * than failing, so `npm test` keeps working exactly as it always has everywhere else in this
 * repo with no DB dependency.
 */

let currentClient: SupabaseClient;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentClient,
}));

const hasSupabaseEnv =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!hasSupabaseEnv) {
  // Deliberate: explains why this file's tests are all (correctly) being skipped when a local
  // `npm test` run has no Docker/Supabase running, rather than the silence looking like the file
  // wasn't picked up at all.
  console.warn(
    "[meals.test.ts] Skipping: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / " +
      "SUPABASE_SERVICE_ROLE_KEY not set (no .env.local, or Supabase isn't running). " +
      "Run `npx supabase start` and re-run `npm test` to exercise these.",
  );
}

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

type SeedItem = { name: string; quantity?: number; caloriesPerUnit: number; proteinGPerUnit: number };

/** Seeds a meal (+ optional items) directly via an RLS-scoped client, same shape the app writes. */
async function seedMeal(
  client: SupabaseClient,
  user: TestUser,
  name: string,
  items: SeedItem[],
): Promise<{ meal: Meal; items: MealItem[] }> {
  const { data: meal, error } = await client
    .from("meals")
    .insert({ user_id: user.id, name })
    .select()
    .single();
  if (error || !meal) throw new Error(`seedMeal failed: ${error?.message}`);
  if (items.length === 0) return { meal: meal as Meal, items: [] };

  const { data: rows, error: itemsError } = await client
    .from("meal_items")
    .insert(
      items.map((item, index) => ({
        meal_id: (meal as Meal).id,
        user_id: user.id,
        name: item.name,
        quantity: item.quantity ?? 1,
        calories_per_unit: item.caloriesPerUnit,
        protein_g_per_unit: item.proteinGPerUnit,
        sort_order: index,
      })),
    )
    .select()
    .order("sort_order", { ascending: true });
  if (itemsError || !rows) throw new Error(`seedMeal items failed: ${itemsError?.message}`);

  return { meal: meal as Meal, items: rows as MealItem[] };
}

/** Seeds a meal with items at explicit, possibly NON-CONTIGUOUS `sort_order` values (e.g. 0/2/5) --
 * `seedMeal` above always assigns sequential 0..N-1, which is exactly the case that would let a
 * `duplicateMeal` implementation that mechanically renumbers pass by coincidence (design doc §6:
 * "seed a source whose sort_orders are non-contiguous... so a renumbering implementation fails"). */
async function seedMealWithSortOrders(
  client: SupabaseClient,
  user: TestUser,
  name: string,
  items: (SeedItem & { sortOrder: number })[],
): Promise<{ meal: Meal; items: MealItem[] }> {
  const { data: meal, error } = await client
    .from("meals")
    .insert({ user_id: user.id, name })
    .select()
    .single();
  if (error || !meal) throw new Error(`seedMealWithSortOrders failed: ${error?.message}`);

  const { data: rows, error: itemsError } = await client
    .from("meal_items")
    .insert(
      items.map((item) => ({
        meal_id: (meal as Meal).id,
        user_id: user.id,
        name: item.name,
        quantity: item.quantity ?? 1,
        calories_per_unit: item.caloriesPerUnit,
        protein_g_per_unit: item.proteinGPerUnit,
        sort_order: item.sortOrder,
      })),
    )
    .select()
    .order("sort_order", { ascending: true });
  if (itemsError || !rows) throw new Error(`seedMealWithSortOrders items failed: ${itemsError?.message}`);

  return { meal: meal as Meal, items: rows as MealItem[] };
}

/** Runs a SQL statement against the real local Supabase Postgres container via `docker exec psql`
 * (the same technique `e2e/phase7b-acceptance.spec.ts`'s fault-injection tests already use), with
 * `-t -A -F','` for tuple-only, unaligned, comma-separated output that's trivial to parse into
 * rows of string cells. Used both to VERIFY the Phase 8f migration's RLS claim by querying the
 * actual system catalogs (design doc §3.2/§6: "verify by query, not by reading the SQL") and to
 * fault-inject a forced `meal_items` insert failure for `duplicateMeal`'s compensating-delete test. */
function psqlCsv(sql: string): string[][] {
  const raw = execFileSync(
    "docker",
    ["exec", "supabase_db_health-tracker", "psql", "-U", "postgres", "-d", "postgres", "-t", "-A", "-F", ",", "-c", sql],
    { encoding: "utf8" },
  );
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(","));
}

function psqlExec(sql: string): void {
  execFileSync(
    "docker",
    ["exec", "supabase_db_health-tracker", "psql", "-U", "postgres", "-d", "postgres", "-c", sql],
    { encoding: "utf8" },
  );
}

/** Builds a FormData with a repeated `entryIds` field, matching how SaveGroupAsMealDialog submits
 * one hidden `<input name="entryIds">` per entry, plus any other scalar fields. */
function multiFormData(entryIds: string[], fields: Record<string, string> = {}): FormData {
  const fd = new FormData();
  for (const id of entryIds) fd.append("entryIds", id);
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

type SeedEntry = {
  name: string;
  quantity?: number;
  unit?: string | null;
  caloriesPerUnit: number;
  proteinGPerUnit: number;
  consumedAt: string;
  consumedTz?: string;
};

/**
 * Seeds `food_entries` rows directly via an RLS-scoped client, same shape the app writes. Inserts
 * one row PER STATEMENT (sequential `await`s), deliberately not one multi-row insert — Postgres's
 * `now()` (and therefore a `created_at default now()` column) is stable for the whole duration of
 * a single statement, so a batch insert would give every row in the array the exact same
 * `created_at`, which is not how real usage produces a group (each entry is logged via its own
 * separate `addFoodEntry` call/request). `mealItemsFromEntries`'s `created_at`-then-`id` ordering
 * needs genuinely distinct `created_at`s to be meaningfully exercised here.
 */
async function seedEntries(
  client: SupabaseClient,
  user: TestUser,
  entries: SeedEntry[],
): Promise<FoodEntry[]> {
  const rows: FoodEntry[] = [];
  for (const entry of entries) {
    const { data: row, error } = await client
      .from("food_entries")
      .insert({
        user_id: user.id,
        name: entry.name,
        quantity: entry.quantity ?? 1,
        unit: entry.unit ?? null,
        calories_per_unit: entry.caloriesPerUnit,
        protein_g_per_unit: entry.proteinGPerUnit,
        consumed_at: entry.consumedAt,
        consumed_tz: entry.consumedTz ?? "UTC",
      })
      .select()
      .single();
    if (error || !row) throw new Error(`seedEntries failed: ${error?.message}`);
    rows.push(row as FoodEntry);
  }
  return rows;
}

function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function localTomorrow(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

describe.skipIf(!hasSupabaseEnv)("meals actions (integration, real Postgres/RLS)", () => {
  describe("meals CRUD", () => {
    let user: TestUser;
    let client: SupabaseClient;

    beforeEach(async () => {
      user = await createConfirmedTestUser();
      client = await createUserClient(user);
      currentClient = client;
    });

    afterEach(async () => {
      await deleteTestUser(user.id);
    });

    it("createMeal inserts a row owned by the caller", async () => {
      const { createMeal } = await import("./meals");
      const result = await createMeal({ ok: false, error: null }, formData({ name: "Test Meal" }));

      expect(result.ok).toBe(true);
      expect(result.meal?.name).toBe("Test Meal");
      expect(result.meal?.user_id).toBe(user.id);
    });

    it("createMeal rejects a blank name and inserts no row", async () => {
      const { createMeal } = await import("./meals");
      const result = await createMeal({ ok: false, error: null }, formData({ name: "   " }));

      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.name).toBeTruthy();

      const admin = createAdminClient();
      const { data } = await admin.from("meals").select("*").eq("user_id", user.id);
      expect(data ?? []).toHaveLength(0);
    });

    it("updateMeal renames a meal the caller owns", async () => {
      const { meal } = await seedMeal(client, user, "Old Name", []);
      const { updateMeal } = await import("./meals");
      const result = await updateMeal(
        { ok: false, error: null },
        formData({ id: meal.id, name: "New Name" }),
      );

      expect(result.ok).toBe(true);
      expect(result.meal?.name).toBe("New Name");
    });

    it("deleteMeal removes the meal and cascades its items, without touching other users' data", async () => {
      const { meal } = await seedMeal(client, user, "Doomed", [
        { name: "Item1", caloriesPerUnit: 10, proteinGPerUnit: 1 },
        { name: "Item2", caloriesPerUnit: 20, proteinGPerUnit: 2 },
      ]);
      const { deleteMeal } = await import("./meals");
      const result = await deleteMeal(meal.id);

      expect(result.ok).toBe(true);

      const admin = createAdminClient();
      const { data: meals } = await admin.from("meals").select("*").eq("id", meal.id);
      expect(meals ?? []).toHaveLength(0);
      const { data: items } = await admin.from("meal_items").select("*").eq("meal_id", meal.id);
      expect(items ?? []).toHaveLength(0);
    });
  });

  describe("logMealForDay -- the logged_from_meal_id ownership invariant", () => {
    let attacker: TestUser;
    let victim: TestUser;
    let attackerClient: SupabaseClient;

    beforeEach(async () => {
      attacker = await createConfirmedTestUser();
      victim = await createConfirmedTestUser();
      attackerClient = await createUserClient(attacker);
      currentClient = attackerClient;
    });

    afterEach(async () => {
      await deleteTestUser(attacker.id);
      await deleteTestUser(victim.id);
    });

    it("rejects ANOTHER user's mealId and writes zero rows anywhere", async () => {
      const victimClient = await createUserClient(victim);
      const { meal: victimMeal } = await seedMeal(victimClient, victim, "Victim Meal", [
        { name: "VictimEggs", caloriesPerUnit: 70, proteinGPerUnit: 6 },
      ]);

      currentClient = attackerClient;
      const { logMealForDay } = await import("./meals");
      const result = await logMealForDay(
        { ok: false, error: null },
        formData({ mealId: victimMeal.id, logDate: localToday(), logTime: "12:00", logTz: "UTC" }),
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("meal_not_found");

      // Direct DB verification (service-role, sees everything) -- the return value alone isn't trusted.
      const admin = createAdminClient();
      const { data: referencing } = await admin
        .from("food_entries")
        .select("*")
        .eq("logged_from_meal_id", victimMeal.id);
      expect(referencing ?? []).toHaveLength(0);
      const { data: attackerEntries } = await admin.from("food_entries").select("*").eq("user_id", attacker.id);
      expect(attackerEntries ?? []).toHaveLength(0);
      const { data: victimEntries } = await admin.from("food_entries").select("*").eq("user_id", victim.id);
      expect(victimEntries ?? []).toHaveLength(0);
    });

    it("rejects a nonexistent mealId and writes zero rows", async () => {
      const { logMealForDay } = await import("./meals");
      const result = await logMealForDay(
        { ok: false, error: null },
        formData({
          mealId: "00000000-0000-4000-8000-000000000000",
          logDate: localToday(),
          logTime: "12:00",
          logTz: "UTC",
        }),
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("meal_not_found");

      const admin = createAdminClient();
      const { data } = await admin.from("food_entries").select("*").eq("user_id", attacker.id);
      expect(data ?? []).toHaveLength(0);
    });

    it("logging the caller's own meal writes rows carrying the caller's own meal id", async () => {
      const { meal } = await seedMeal(attackerClient, attacker, "Own Meal", [
        { name: "OwnA", caloriesPerUnit: 100, proteinGPerUnit: 10 },
        { name: "OwnB", quantity: 3, caloriesPerUnit: 50, proteinGPerUnit: 2 },
      ]);

      const { logMealForDay } = await import("./meals");
      const result = await logMealForDay(
        { ok: false, error: null },
        formData({ mealId: meal.id, logDate: localToday(), logTime: "12:00", logTz: "UTC" }),
      );

      expect(result.ok).toBe(true);
      expect(result.entries).toHaveLength(2);
      for (const entry of result.entries ?? []) {
        expect(entry.logged_from_meal_id).toBe(meal.id);
        expect(entry.user_id).toBe(attacker.id);
      }
    });
  });

  describe("logMealForDay -- empty meal rejected", () => {
    let user: TestUser;
    let client: SupabaseClient;

    beforeEach(async () => {
      user = await createConfirmedTestUser();
      client = await createUserClient(user);
      currentClient = client;
    });

    afterEach(async () => {
      await deleteTestUser(user.id);
    });

    it("rejects logging a meal with zero items and writes no rows", async () => {
      const { meal } = await seedMeal(client, user, "Hollow Meal", []);
      const { logMealForDay } = await import("./meals");
      const result = await logMealForDay(
        { ok: false, error: null },
        formData({ mealId: meal.id, logDate: localToday(), logTime: "12:00", logTz: "UTC" }),
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("empty_meal");

      const admin = createAdminClient();
      const { data } = await admin.from("food_entries").select("*").eq("user_id", user.id);
      expect(data ?? []).toHaveLength(0);
    });
  });

  describe("logMealForDay -- future-day cap", () => {
    let user: TestUser;
    let client: SupabaseClient;

    beforeEach(async () => {
      user = await createConfirmedTestUser();
      client = await createUserClient(user);
      currentClient = client;
    });

    afterEach(async () => {
      await deleteTestUser(user.id);
    });

    it("rejects a meal dated tomorrow and writes no rows", async () => {
      const { meal } = await seedMeal(client, user, "Future Meal", [
        { name: "FutureItem", caloriesPerUnit: 100, proteinGPerUnit: 5 },
      ]);
      const { logMealForDay } = await import("./meals");
      const result = await logMealForDay(
        { ok: false, error: null },
        formData({ mealId: meal.id, logDate: localTomorrow(), logTime: "12:00", logTz: "UTC" }),
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("future_date");

      const admin = createAdminClient();
      const { data } = await admin.from("food_entries").select("*").eq("user_id", user.id);
      expect(data ?? []).toHaveLength(0);
    });

    it("the same meal logs fine for today (the cap is a day cap, not a blanket rejection)", async () => {
      const { meal } = await seedMeal(client, user, "Today Meal", [
        { name: "TodayItem", caloriesPerUnit: 100, proteinGPerUnit: 5 },
      ]);
      const { logMealForDay } = await import("./meals");
      const result = await logMealForDay(
        { ok: false, error: null },
        formData({ mealId: meal.id, logDate: localToday(), logTime: "12:00", logTz: "UTC" }),
      );

      expect(result.ok).toBe(true);
      expect(result.entries).toHaveLength(1);
    });
  });

  describe("logMealForDay -- graceful invalid-timezone handling (qa-reviewer N-1)", () => {
    let user: TestUser;
    let client: SupabaseClient;

    beforeEach(async () => {
      user = await createConfirmedTestUser();
      client = await createUserClient(user);
      currentClient = client;
    });

    afterEach(async () => {
      await deleteTestUser(user.id);
    });

    it("returns a graceful error (does not throw) for a garbled logTz, and writes no rows", async () => {
      const { meal } = await seedMeal(client, user, "Tz Meal", [
        { name: "TzItem", caloriesPerUnit: 100, proteinGPerUnit: 5 },
      ]);
      const { logMealForDay } = await import("./meals");

      const result = await logMealForDay(
        { ok: false, error: null },
        formData({ mealId: meal.id, logDate: localToday(), logTime: "12:00", logTz: "Not/AZone" }),
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("invalid_timezone");

      const admin = createAdminClient();
      const { data } = await admin.from("food_entries").select("*").eq("user_id", user.id);
      expect(data ?? []).toHaveLength(0);
    });
  });

  describe("createMealFromEntries (Phase 7b -- 'Save a logged meal group as a Saved Meal')", () => {
    let user: TestUser;
    let client: SupabaseClient;

    beforeEach(async () => {
      user = await createConfirmedTestUser();
      client = await createUserClient(user);
      currentClient = client;
    });

    afterEach(async () => {
      await deleteTestUser(user.id);
    });

    it("faithfully copies a 3-entry group into a new meal, ordered as logged, with matching totals", async () => {
      const shared = "2026-07-30T12:00:00Z";
      const entries = await seedEntries(client, user, [
        { name: "Eggs", quantity: 2, caloriesPerUnit: 70, proteinGPerUnit: 6, consumedAt: shared },
        { name: "Toast", quantity: 2, unit: "slice", caloriesPerUnit: 80, proteinGPerUnit: 3, consumedAt: shared },
        { name: "Coffee", caloriesPerUnit: 5, proteinGPerUnit: 0, consumedAt: shared },
      ]);
      // Insert order above already matches created_at order; ids are shuffled here to prove the
      // action (via mealItemsFromEntries) doesn't just trust the id list's order.
      const shuffledIds = [entries[2].id, entries[0].id, entries[1].id];

      const { createMealFromEntries } = await import("./meals");
      const result = await createMealFromEntries(
        { ok: false, error: null },
        multiFormData(shuffledIds, { name: "Weekday breakfast" }),
      );

      expect(result.ok).toBe(true);
      expect(result.meal?.name).toBe("Weekday breakfast");
      expect(result.meal?.user_id).toBe(user.id);

      const admin = createAdminClient();
      const { data: items } = await admin
        .from("meal_items")
        .select("*")
        .eq("meal_id", result.meal!.id)
        .order("sort_order", { ascending: true });
      const mealItems = (items ?? []) as MealItem[];

      expect(mealItems.map((i) => i.name)).toEqual(["Eggs", "Toast", "Coffee"]);
      expect(mealItems.map((i) => i.sort_order)).toEqual([0, 1, 2]);
      expect(mealItems[0].quantity).toBe(2);
      expect(mealItems[1].unit).toBe("slice");

      const sourceTotalCalories = entries.reduce((sum, e) => sum + e.calories, 0);
      const sourceTotalProtein = entries.reduce((sum, e) => sum + e.protein_g, 0);
      const mealTotalCalories = mealItems.reduce((sum, i) => sum + i.calories, 0);
      const mealTotalProtein = mealItems.reduce((sum, i) => sum + i.protein_g, 0);
      expect(mealTotalCalories).toBe(sourceTotalCalories);
      expect(mealTotalProtein).toBeCloseTo(sourceTotalProtein, 5);
    });

    it("leaves the source entries byte-identical (including updated_at and logged_from_meal_id)", async () => {
      const entries = await seedEntries(client, user, [
        { name: "Solo Snack", caloriesPerUnit: 150, proteinGPerUnit: 5, consumedAt: "2026-07-30T09:00:00Z" },
      ]);

      const admin = createAdminClient();
      const { data: before } = await admin.from("food_entries").select("*").eq("id", entries[0].id).single();

      const { createMealFromEntries } = await import("./meals");
      const result = await createMealFromEntries(
        { ok: false, error: null },
        multiFormData([entries[0].id], { name: "Solo Meal" }),
      );
      expect(result.ok).toBe(true);

      const { data: after } = await admin.from("food_entries").select("*").eq("id", entries[0].id).single();
      expect(after).toEqual(before);
    });

    it("saves a one-entry group as a valid one-item meal, and that meal logs successfully", async () => {
      const entries = await seedEntries(client, user, [
        { name: "Apple", caloriesPerUnit: 95, proteinGPerUnit: 0, consumedAt: "2026-07-30T09:00:00Z" },
      ]);

      const { createMealFromEntries, logMealForDay } = await import("./meals");
      const result = await createMealFromEntries(
        { ok: false, error: null },
        multiFormData([entries[0].id], { name: "Just an Apple" }),
      );
      expect(result.ok).toBe(true);

      // The one-item meal must NOT be rejected by logMealForDay's empty_meal check.
      const logResult = await logMealForDay(
        { ok: false, error: null },
        formData({ mealId: result.meal!.id, logDate: localToday(), logTime: "12:00", logTz: "UTC" }),
      );
      expect(logResult.ok).toBe(true);
      expect(logResult.entries).toHaveLength(1);
      expect(logResult.entries?.[0].name).toBe("Apple");
    });

    it("round-trips: save a group, then logMealForDay the new meal reproduces the group's items/totals as one group", async () => {
      const shared = "2026-07-30T08:00:00Z";
      const entries = await seedEntries(client, user, [
        { name: "Oats", caloriesPerUnit: 150, proteinGPerUnit: 5, consumedAt: shared },
        { name: "Banana", caloriesPerUnit: 105, proteinGPerUnit: 1, consumedAt: shared },
      ]);

      const { createMealFromEntries, logMealForDay } = await import("./meals");
      const saveResult = await createMealFromEntries(
        { ok: false, error: null },
        multiFormData(entries.map((e) => e.id), { name: "Oatmeal Combo" }),
      );
      expect(saveResult.ok).toBe(true);

      const logResult = await logMealForDay(
        { ok: false, error: null },
        formData({ mealId: saveResult.meal!.id, logDate: localToday(), logTime: "15:00", logTz: "UTC" }),
      );
      expect(logResult.ok).toBe(true);
      expect(logResult.entries).toHaveLength(2);
      // One shared consumed_at across the batch -- a single exact-timestamp group.
      const consumedAts = new Set(logResult.entries!.map((e) => e.consumed_at));
      expect(consumedAts.size).toBe(1);
      const loggedTotalCalories = logResult.entries!.reduce((sum, e) => sum + e.calories, 0);
      const sourceTotalCalories = entries.reduce((sum, e) => sum + e.calories, 0);
      expect(loggedTotalCalories).toBe(sourceTotalCalories);
    });

    it("independence: deleting the new meal leaves the source entries untouched", async () => {
      const entries = await seedEntries(client, user, [
        { name: "Yogurt", caloriesPerUnit: 120, proteinGPerUnit: 10, consumedAt: "2026-07-30T09:00:00Z" },
      ]);
      const { createMealFromEntries, deleteMeal } = await import("./meals");
      const saveResult = await createMealFromEntries(
        { ok: false, error: null },
        multiFormData([entries[0].id], { name: "Yogurt Meal" }),
      );
      expect(saveResult.ok).toBe(true);

      const deleteResult = await deleteMeal(saveResult.meal!.id);
      expect(deleteResult.ok).toBe(true);

      const admin = createAdminClient();
      const { data: entryAfter } = await admin
        .from("food_entries")
        .select("*")
        .eq("id", entries[0].id)
        .single();
      expect(entryAfter).toEqual(entries[0]);
    });

    it("independence: editing the source entry afterwards leaves the meal's item untouched", async () => {
      const entries = await seedEntries(client, user, [
        { name: "Cereal", caloriesPerUnit: 200, proteinGPerUnit: 4, consumedAt: "2026-07-30T09:00:00Z" },
      ]);
      const { createMealFromEntries } = await import("./meals");
      const saveResult = await createMealFromEntries(
        { ok: false, error: null },
        multiFormData([entries[0].id], { name: "Cereal Meal" }),
      );
      expect(saveResult.ok).toBe(true);

      // Edit the SOURCE entry (not the meal item) directly via the RLS-scoped client -- editing a
      // food_entries row after the fact must never ripple into the already-created meal's item,
      // since meal_items copied the value at save time and holds no reference back.
      await client.from("food_entries").update({ name: "Cereal (edited)" }).eq("id", entries[0].id);

      const admin = createAdminClient();
      const { data: items } = await admin
        .from("meal_items")
        .select("*")
        .eq("meal_id", saveResult.meal!.id);
      expect((items ?? [])[0].name).toBe("Cereal");
    });

    it("a group whose entries carry logged_from_meal_id (from a prior logMealForDay) saves fine as an independent clone", async () => {
      const { createMeal, addMealItem, logMealForDay } = await import("./meals");
      const created = await createMeal({ ok: false, error: null }, formData({ name: "Original Meal" }));
      const originalMeal = created.meal!;
      await addMealItem(
        { ok: false, error: null },
        formData({ mealId: originalMeal.id, name: "Bagel", calories: "250", protein: "9", mode: "total" }),
      );
      const logged = await logMealForDay(
        { ok: false, error: null },
        formData({ mealId: originalMeal.id, logDate: localToday(), logTime: "07:00", logTz: "UTC" }),
      );

      expect(logged.ok).toBe(true);
      const loggedEntry = logged.entries![0];
      expect(loggedEntry.logged_from_meal_id).toBe(originalMeal.id);

      const { createMealFromEntries } = await import("./meals");
      const cloneResult = await createMealFromEntries(
        { ok: false, error: null },
        multiFormData([loggedEntry.id], { name: "Cloned Bagel Meal" }),
      );
      expect(cloneResult.ok).toBe(true);
      expect(cloneResult.meal!.id).not.toBe(originalMeal.id);

      const admin = createAdminClient();
      // Original meal is untouched.
      const { data: originalItems } = await admin
        .from("meal_items")
        .select("*")
        .eq("meal_id", originalMeal.id);
      expect(originalItems ?? []).toHaveLength(1);
      // Source entry's logged_from_meal_id is NOT repointed at the new clone -- still the original.
      const { data: entryAfter } = await admin
        .from("food_entries")
        .select("*")
        .eq("id", loggedEntry.id)
        .single();
      expect((entryAfter as FoodEntry).logged_from_meal_id).toBe(originalMeal.id);
    });

    it("rejects a blank name and writes nothing", async () => {
      const entries = await seedEntries(client, user, [
        { name: "Blank Name Test", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: "2026-07-30T09:00:00Z" },
      ]);
      const { createMealFromEntries } = await import("./meals");
      const result = await createMealFromEntries(
        { ok: false, error: null },
        multiFormData([entries[0].id], { name: "   " }),
      );

      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.name).toBeTruthy();

      const admin = createAdminClient();
      const { data: meals } = await admin.from("meals").select("*").eq("user_id", user.id);
      expect(meals ?? []).toHaveLength(0);
    });

    it("rejects an empty entryIds list with error 'no_entries' and writes nothing", async () => {
      const { createMealFromEntries } = await import("./meals");
      const result = await createMealFromEntries(
        { ok: false, error: null },
        multiFormData([], { name: "Nothing To Save" }),
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("no_entries");

      const admin = createAdminClient();
      const { data: meals } = await admin.from("meals").select("*").eq("user_id", user.id);
      expect(meals ?? []).toHaveLength(0);
    });
  });

  describe("createMealFromEntries -- cross-user rejection (Phase 7b)", () => {
    let attacker: TestUser;
    let victim: TestUser;
    let attackerClient: SupabaseClient;

    beforeEach(async () => {
      attacker = await createConfirmedTestUser();
      victim = await createConfirmedTestUser();
      attackerClient = await createUserClient(attacker);
      currentClient = attackerClient;
    });

    afterEach(async () => {
      await deleteTestUser(attacker.id);
      await deleteTestUser(victim.id);
    });

    it("rejects ANOTHER user's real entry id wholesale, writing zero meals/meal_items rows anywhere", async () => {
      const victimClient = await createUserClient(victim);
      const victimEntries = await seedEntries(victimClient, victim, [
        { name: "Victim Food", caloriesPerUnit: 300, proteinGPerUnit: 20, consumedAt: "2026-07-30T09:00:00Z" },
      ]);

      currentClient = attackerClient;
      const { createMealFromEntries } = await import("./meals");
      const result = await createMealFromEntries(
        { ok: false, error: null },
        multiFormData([victimEntries[0].id], { name: "Stolen Meal" }),
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("entries_not_found");

      const admin = createAdminClient();
      const { data: attackerMeals } = await admin.from("meals").select("*").eq("user_id", attacker.id);
      expect(attackerMeals ?? []).toHaveLength(0);
      const { data: victimMeals } = await admin.from("meals").select("*").eq("user_id", victim.id);
      expect(victimMeals ?? []).toHaveLength(0);
    });

    it("rejects a MIXED set (one own id + one foreign id) wholesale, not a partial meal", async () => {
      const ownEntries = await seedEntries(attackerClient, attacker, [
        { name: "Attacker Food", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: "2026-07-30T09:00:00Z" },
      ]);
      const victimClient = await createUserClient(victim);
      const victimEntries = await seedEntries(victimClient, victim, [
        { name: "Victim Food 2", caloriesPerUnit: 300, proteinGPerUnit: 20, consumedAt: "2026-07-30T09:00:00Z" },
      ]);

      currentClient = attackerClient;
      const { createMealFromEntries } = await import("./meals");
      const result = await createMealFromEntries(
        { ok: false, error: null },
        multiFormData([ownEntries[0].id, victimEntries[0].id], { name: "Mixed Meal" }),
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("entries_not_found");

      const admin = createAdminClient();
      const { data: attackerMeals } = await admin.from("meals").select("*").eq("user_id", attacker.id);
      expect(attackerMeals ?? []).toHaveLength(0);
      const { data: attackerItems } = await admin
        .from("meal_items")
        .select("*")
        .eq("user_id", attacker.id);
      expect(attackerItems ?? []).toHaveLength(0);
    });

    it("rejects a nonexistent entry id", async () => {
      const { createMealFromEntries } = await import("./meals");
      const result = await createMealFromEntries(
        { ok: false, error: null },
        multiFormData(["00000000-0000-4000-8000-000000000000"], { name: "Ghost Meal" }),
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("entries_not_found");

      const admin = createAdminClient();
      const { data: attackerMeals } = await admin.from("meals").select("*").eq("user_id", attacker.id);
      expect(attackerMeals ?? []).toHaveLength(0);
    });
  });

  // -----------------------------------------------------------------------------------------
  // Phase 8f -- "Saved meals: pinning and duplicating" (2026-08-05/08)
  // -----------------------------------------------------------------------------------------

  describe("Phase 8f migration + RLS (verified by query, not by reading the SQL)", () => {
    it("meals.is_pinned exists as NOT NULL DEFAULT false, RLS is still enabled, and all four policies are unchanged", () => {
      const columnRows = psqlCsv(
        "select is_nullable, column_default from information_schema.columns " +
          "where table_schema='public' and table_name='meals' and column_name='is_pinned';",
      );
      expect(columnRows).toHaveLength(1);
      expect(columnRows[0][0]).toBe("NO"); // not null
      expect(columnRows[0][1]).toContain("false"); // default false

      const rlsRows = psqlCsv(
        "select relrowsecurity from pg_class where relname='meals' and relnamespace = 'public'::regnamespace;",
      );
      expect(rlsRows).toHaveLength(1);
      expect(rlsRows[0][0]).toBe("t");

      const policyRows = psqlCsv(
        "select policyname from pg_policies where schemaname='public' and tablename='meals' order by policyname;",
      );
      expect(policyRows.map((row) => row[0])).toEqual([
        "meals_delete_own",
        "meals_insert_own",
        "meals_select_own",
        "meals_update_own",
      ]);
    });

    it("a pre-existing meal (created before this test, i.e. via the ordinary insert path) defaults to is_pinned = false", async () => {
      const user = await createConfirmedTestUser();
      try {
        const client = await createUserClient(user);
        currentClient = client;
        const { meal } = await seedMeal(client, user, "Default Pin Check", []);
        expect(meal.is_pinned).toBe(false);
      } finally {
        await deleteTestUser(user.id);
      }
    });
  });

  describe("setMealPinned", () => {
    let user: TestUser;
    let client: SupabaseClient;

    beforeEach(async () => {
      user = await createConfirmedTestUser();
      client = await createUserClient(user);
      currentClient = client;
    });

    afterEach(async () => {
      await deleteTestUser(user.id);
    });

    it("pins and unpins a meal the caller owns", async () => {
      const { meal } = await seedMeal(client, user, "Pin Me", []);
      const { setMealPinned } = await import("./meals");

      const pinned = await setMealPinned(meal.id, true);
      expect(pinned.ok).toBe(true);
      const admin = createAdminClient();
      const { data: afterPin } = await admin.from("meals").select("*").eq("id", meal.id).single();
      expect((afterPin as Meal).is_pinned).toBe(true);

      const unpinned = await setMealPinned(meal.id, false);
      expect(unpinned.ok).toBe(true);
      const { data: afterUnpin } = await admin.from("meals").select("*").eq("id", meal.id).single();
      expect((afterUnpin as Meal).is_pinned).toBe(false);
    });
  });

  describe("setMealPinned -- cross-user rejection (the real RLS test, not just reading the migration)", () => {
    let attacker: TestUser;
    let victim: TestUser;
    let attackerClient: SupabaseClient;

    beforeEach(async () => {
      attacker = await createConfirmedTestUser();
      victim = await createConfirmedTestUser();
      attackerClient = await createUserClient(attacker);
      currentClient = attackerClient;
    });

    afterEach(async () => {
      await deleteTestUser(attacker.id);
      await deleteTestUser(victim.id);
    });

    it("user B cannot pin user A's meal -- A's row is untouched (service-role read)", async () => {
      const victimClient = await createUserClient(victim);
      const { meal: victimMeal } = await seedMeal(victimClient, victim, "Victim's Meal", []);
      expect(victimMeal.is_pinned).toBe(false);

      currentClient = attackerClient;
      const { setMealPinned } = await import("./meals");
      // `meals_update_own`'s `using`/`with check` mean this UPDATE simply matches zero rows -- not
      // a thrown error -- so the action itself reports ok:true even though nothing was touched.
      // The load-bearing assertion is the service-role read below, exactly as the design doc's §6
      // row specifies ("assert, via a service-role read, that A's row is untouched").
      await setMealPinned(victimMeal.id, true);

      const admin = createAdminClient();
      const { data: victimRow } = await admin.from("meals").select("*").eq("id", victimMeal.id).single();
      expect((victimRow as Meal).is_pinned).toBe(false);
    });
  });

  describe("duplicateMeal", () => {
    let user: TestUser;
    let client: SupabaseClient;

    beforeEach(async () => {
      user = await createConfirmedTestUser();
      client = await createUserClient(user);
      currentClient = client;
    });

    afterEach(async () => {
      await deleteTestUser(user.id);
    });

    it("duplicates a 3-item meal faithfully, preserving NON-CONTIGUOUS sort_order (not renumbered)", async () => {
      const { meal, items } = await seedMealWithSortOrders(client, user, "Weekday breakfast", [
        { name: "Eggs", sortOrder: 0, caloriesPerUnit: 70, proteinGPerUnit: 6 },
        { name: "Toast", sortOrder: 2, caloriesPerUnit: 80, proteinGPerUnit: 3 },
        { name: "Coffee", sortOrder: 5, caloriesPerUnit: 5, proteinGPerUnit: 0 },
      ]);
      expect(items.map((i) => i.sort_order)).toEqual([0, 2, 5]);

      const { duplicateMeal } = await import("./meals");
      const result = await duplicateMeal(
        { ok: false, error: null },
        formData({ mealId: meal.id, name: "Weekday breakfast (copy)" }),
      );

      expect(result.ok).toBe(true);
      expect(result.meal?.name).toBe("Weekday breakfast (copy)");
      expect(result.meal?.id).not.toBe(meal.id);

      const admin = createAdminClient();
      const { data: newItems } = await admin
        .from("meal_items")
        .select("*")
        .eq("meal_id", result.meal!.id)
        .order("sort_order", { ascending: true });

      // sort_order PRESERVED (0/2/5), NOT renumbered to 0/1/2 -- a mechanical
      // `mealItemsFromEntries`-style renumbering implementation would fail this assertion.
      expect((newItems ?? []).map((i) => i.sort_order)).toEqual([0, 2, 5]);
      expect((newItems ?? []).map((i) => i.name)).toEqual(["Eggs", "Toast", "Coffee"]);
      expect((newItems ?? []).map((i) => i.quantity)).toEqual(items.map((i) => i.quantity));
      expect((newItems ?? []).map((i) => i.unit)).toEqual(items.map((i) => i.unit));
      expect((newItems ?? []).map((i) => i.calories_per_unit)).toEqual(
        items.map((i) => i.calories_per_unit),
      );
      expect((newItems ?? []).map((i) => i.protein_g_per_unit)).toEqual(
        items.map((i) => i.protein_g_per_unit),
      );

      // The generated-total invariant: the duplicate's summed totals equal the source's exactly,
      // because both sides run the identical round(quantity * per-unit) generated expression.
      const sourceTotalCalories = items.reduce((sum, i) => sum + i.calories, 0);
      const newTotalCalories = (newItems ?? []).reduce((sum, i) => sum + i.calories, 0);
      expect(newTotalCalories).toBe(sourceTotalCalories);
    });

    it("the source meal and its items are byte-identical afterwards, updated_at included", async () => {
      const { meal } = await seedMeal(client, user, "Source Untouched", [
        { name: "Rice", caloriesPerUnit: 130, proteinGPerUnit: 2.5 },
      ]);

      const admin = createAdminClient();
      const { data: mealBefore } = await admin.from("meals").select("*").eq("id", meal.id).single();
      const { data: itemsBefore } = await admin
        .from("meal_items")
        .select("*")
        .eq("meal_id", meal.id)
        .order("sort_order", { ascending: true });

      const { duplicateMeal } = await import("./meals");
      const result = await duplicateMeal(
        { ok: false, error: null },
        formData({ mealId: meal.id, name: "Source Untouched (copy)" }),
      );
      expect(result.ok).toBe(true);

      const { data: mealAfter } = await admin.from("meals").select("*").eq("id", meal.id).single();
      const { data: itemsAfter } = await admin
        .from("meal_items")
        .select("*")
        .eq("meal_id", meal.id)
        .order("sort_order", { ascending: true });

      expect(mealAfter).toEqual(mealBefore);
      expect(itemsAfter).toEqual(itemsBefore);
    });

    it("is_pinned is NOT copied -- the duplicate starts unpinned even when the source is pinned", async () => {
      const { meal } = await seedMeal(client, user, "Pinned Source", [
        { name: "Snack", caloriesPerUnit: 50, proteinGPerUnit: 2 },
      ]);
      const { setMealPinned, duplicateMeal } = await import("./meals");
      await setMealPinned(meal.id, true);

      const result = await duplicateMeal(
        { ok: false, error: null },
        formData({ mealId: meal.id, name: "Pinned Source (copy)" }),
      );
      expect(result.ok).toBe(true);
      expect(result.meal?.is_pinned).toBe(false);
    });

    it("an empty source meal (zero items) duplicates successfully into an empty meal, still refused by logMealForDay", async () => {
      const { meal } = await seedMeal(client, user, "Empty Meal", []);
      const { duplicateMeal, logMealForDay } = await import("./meals");

      const result = await duplicateMeal(
        { ok: false, error: null },
        formData({ mealId: meal.id, name: "Empty Meal (copy)" }),
      );
      expect(result.ok).toBe(true);
      expect(result.meal).toBeTruthy();

      const admin = createAdminClient();
      const { data: newItems } = await admin
        .from("meal_items")
        .select("*")
        .eq("meal_id", result.meal!.id);
      expect(newItems ?? []).toHaveLength(0);

      const logResult = await logMealForDay(
        { ok: false, error: null },
        formData({ mealId: result.meal!.id, logDate: localToday(), logTime: "12:00", logTz: "UTC" }),
      );
      expect(logResult.ok).toBe(false);
      expect(logResult.error).toBe("empty_meal");
    });

    it("rejects a blank name and creates no meal", async () => {
      const { meal } = await seedMeal(client, user, "Blank Name Source", []);
      const { duplicateMeal } = await import("./meals");
      const before = await createAdminClient()
        .from("meals")
        .select("*")
        .eq("user_id", user.id);

      const result = await duplicateMeal(
        { ok: false, error: null },
        formData({ mealId: meal.id, name: "   " }),
      );
      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.name).toBeTruthy();

      const admin = createAdminClient();
      const { data: after } = await admin.from("meals").select("*").eq("user_id", user.id);
      expect((after ?? []).length).toBe((before.data ?? []).length);
    });

    it("independence in both directions: editing/deleting the duplicate leaves the source untouched, and vice versa", async () => {
      const { meal: source, items } = await seedMeal(client, user, "Independence Source", [
        { name: "Bagel", caloriesPerUnit: 250, proteinGPerUnit: 9 },
      ]);
      const { duplicateMeal, updateMeal, deleteMealItem } = await import("./meals");
      const result = await duplicateMeal(
        { ok: false, error: null },
        formData({ mealId: source.id, name: "Independence Source (copy)" }),
      );
      expect(result.ok).toBe(true);
      const duplicate = result.meal!;

      // Editing the duplicate's name must not touch the source.
      await updateMeal({ ok: false, error: null }, formData({ id: duplicate.id, name: "Renamed Copy" }));
      const admin = createAdminClient();
      const { data: sourceAfterEdit } = await admin.from("meals").select("*").eq("id", source.id).single();
      expect((sourceAfterEdit as Meal).name).toBe("Independence Source");

      // Deleting the SOURCE's item must not touch the duplicate's item.
      await deleteMealItem(items[0].id);
      const { data: duplicateItemsAfterSourceDelete } = await admin
        .from("meal_items")
        .select("*")
        .eq("meal_id", duplicate.id);
      expect(duplicateItemsAfterSourceDelete ?? []).toHaveLength(1);
    });

    it("FAULT INJECTION: a failed meal_items insert leaves no orphan meal (compensating delete)", async () => {
      const { meal } = await seedMeal(client, user, "Compensate Source", [
        { name: "Item", caloriesPerUnit: 10, proteinGPerUnit: 1 },
      ]);
      const before = await createAdminClient().from("meals").select("*").eq("user_id", user.id);

      // Forces the SECOND statement (the new meal_items insert) to fail while the first (the new
      // meals row) succeeds -- the exact residual-state window the compensating-delete contract is
      // about. A distinct trigger name from phase7b-acceptance.spec.ts's own fault injection, so
      // the two can never collide even if ever run concurrently against the same DB.
      psqlExec(
        "create or replace function public.d8f_block_items() returns trigger as " +
          "$fn$ begin raise exception 'Phase 8f forced meal_items failure'; end; $fn$ language plpgsql; " +
          "create trigger d8f_block_items before insert on public.meal_items " +
          "for each row execute function public.d8f_block_items();",
      );
      try {
        const { duplicateMeal } = await import("./meals");
        const result = await duplicateMeal(
          { ok: false, error: null },
          formData({ mealId: meal.id, name: "Compensate Source (copy)" }),
        );
        expect(result.ok).toBe(false);
      } finally {
        psqlExec(
          "drop trigger if exists d8f_block_items on public.meal_items; " +
            "drop function if exists public.d8f_block_items();",
        );
      }

      const admin = createAdminClient();
      const { data: after } = await admin.from("meals").select("*").eq("user_id", user.id);
      // No orphan "Compensate Source (copy)" meal survives -- only the original source remains.
      expect((after ?? []).length).toBe((before.data ?? []).length);
      expect((after ?? []).map((m) => m.name)).not.toContain("Compensate Source (copy)");
    });
  });

  describe("duplicateMeal -- cross-user rejection", () => {
    let attacker: TestUser;
    let victim: TestUser;
    let attackerClient: SupabaseClient;

    beforeEach(async () => {
      attacker = await createConfirmedTestUser();
      victim = await createConfirmedTestUser();
      attackerClient = await createUserClient(attacker);
      currentClient = attackerClient;
    });

    afterEach(async () => {
      await deleteTestUser(attacker.id);
      await deleteTestUser(victim.id);
    });

    it("rejects ANOTHER user's mealId with meal_not_found (reused, not a new code) and writes zero rows for either user", async () => {
      const victimClient = await createUserClient(victim);
      const { meal: victimMeal } = await seedMeal(victimClient, victim, "Victim's Meal", [
        { name: "VictimSnack", caloriesPerUnit: 40, proteinGPerUnit: 1 },
      ]);

      currentClient = attackerClient;
      const { duplicateMeal } = await import("./meals");
      const result = await duplicateMeal(
        { ok: false, error: null },
        formData({ mealId: victimMeal.id, name: "Stolen Duplicate" }),
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("meal_not_found");

      const admin = createAdminClient();
      const { data: attackerMeals } = await admin.from("meals").select("*").eq("user_id", attacker.id);
      expect(attackerMeals ?? []).toHaveLength(0);
      const { data: victimMeals } = await admin.from("meals").select("*").eq("user_id", victim.id);
      expect((victimMeals ?? []).map((m) => m.id)).toEqual([victimMeal.id]);
    });

    it("rejects a nonexistent mealId", async () => {
      const { duplicateMeal } = await import("./meals");
      const result = await duplicateMeal(
        { ok: false, error: null },
        formData({ mealId: "00000000-0000-4000-8000-000000000000", name: "Ghost Duplicate" }),
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("meal_not_found");

      const admin = createAdminClient();
      const { data: attackerMeals } = await admin.from("meals").select("*").eq("user_id", attacker.id);
      expect(attackerMeals ?? []).toHaveLength(0);
    });
  });
});

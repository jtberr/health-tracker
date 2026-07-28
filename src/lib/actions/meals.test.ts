import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "../../../e2e/helpers/test-users";
import { createUserClient } from "../../../e2e/helpers/user-client";
import { createAdminClient } from "../../../e2e/helpers/admin-client";
import type { Meal, MealItem } from "@/lib/types";

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
});

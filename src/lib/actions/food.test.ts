import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "../../../e2e/helpers/test-users";
import { createUserClient } from "../../../e2e/helpers/user-client";
import { createAdminClient } from "../../../e2e/helpers/admin-client";
import type { FoodEntry } from "@/lib/types";

/**
 * Developer-owned integration tests for `src/lib/actions/food.ts`.
 *
 * The "graceful invalid-timezone handling" block covers the qa-reviewer N-1 fix:
 * `addFoodEntry`/`updateFoodEntry` must reject a garbled/tampered `consumedTz` gracefully (an
 * `{ ok: false, error: "invalid_timezone" }` result), not throw an uncaught `RangeError` that
 * surfaces a generic Next.js error page. See `src/lib/domain/datetime.ts`'s `isValidTimeZone` doc
 * comment and `src/lib/actions/meals.test.ts` (the same fix, applied identically to
 * `logMealForDay`, which is where qa-reviewer originally found this).
 *
 * The "copyFoodEntries" block covers Phase 8 ("Ease-of-entry extras (copy/repeat)") — the shared
 * primitive behind all three copy/repeat mechanisms (copy-day, "Log again", copy-group). Follows
 * the same real-Postgres/RLS mocking technique as `meals.test.ts`'s coverage of
 * `createMealFromEntries` (the closest sibling: both re-read caller-supplied ids through the
 * RLS-scoped client and reject a foreign/mixed/nonexistent set wholesale) — see that file's doc
 * comment for the full rationale.
 *
 * Both blocks skip cleanly via `describe.skipIf` when a local Supabase instance isn't reachable
 * (e.g. CI's "Unit tests" step, which runs before Supabase is started).
 */

let currentClient: SupabaseClient;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentClient,
}));

const hasSupabaseEnv =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

type SeedEntryFields = {
  name: string;
  quantity?: number;
  unit?: string | null;
  caloriesPerUnit: number;
  proteinGPerUnit: number;
  consumedAt: string;
  consumedTz?: string;
};

/** Seeds a `food_entries` row directly via an RLS-scoped client, with a caller-chosen `consumed_at`
 * so tests can assert exactly what time-of-day a copy preserves/overrides. */
async function seedEntry(client: SupabaseClient, user: TestUser, fields: SeedEntryFields): Promise<FoodEntry> {
  const { data, error } = await client
    .from("food_entries")
    .insert({
      user_id: user.id,
      name: fields.name,
      quantity: fields.quantity ?? 1,
      unit: fields.unit ?? null,
      calories_per_unit: fields.caloriesPerUnit,
      protein_g_per_unit: fields.proteinGPerUnit,
      consumed_at: fields.consumedAt,
      consumed_tz: fields.consumedTz ?? "UTC",
    })
    .select()
    .single();
  if (error || !data) throw new Error(`seedEntry failed: ${error?.message}`);
  return data as FoodEntry;
}

/** "Tomorrow" computed from UTC, not the test runner's system-local clock — deliberately avoiding
 * the documented `localTomorrow()` flake in `meals.test.ts` (a system-local "tomorrow" can already
 * equal "today" in UTC near a day boundary, since these tests always pass `toTz: "UTC"`). */
function utcTomorrow(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

describe.skipIf(!hasSupabaseEnv)("food actions (integration, real Postgres/RLS)", () => {
  describe("graceful invalid-timezone handling (qa-reviewer N-1)", () => {
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

    it("addFoodEntry returns a graceful error (does not throw) for a garbled consumedTz, and writes no rows", async () => {
      const { addFoodEntry } = await import("./food");

      const result = await addFoodEntry(
        { ok: false, error: null },
        formData({
          name: "Garbled Tz Food",
          quantity: "1",
          mode: "total",
          calories: "100",
          protein: "5",
          consumedDate: "2026-01-01",
          consumedTime: "12:00",
          consumedTz: "Not/AZone",
        }),
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("invalid_timezone");

      const admin = createAdminClient();
      const { data } = await admin.from("food_entries").select("*").eq("user_id", user.id);
      expect(data ?? []).toHaveLength(0);
    });

    it("updateFoodEntry returns a graceful error (does not throw) for a garbled consumedTz, and leaves the row untouched", async () => {
      const { addFoodEntry, updateFoodEntry } = await import("./food");

      const created = await addFoodEntry(
        { ok: false, error: null },
        formData({
          name: "Original Name",
          quantity: "1",
          mode: "total",
          calories: "100",
          protein: "5",
          consumedDate: "2026-01-01",
          consumedTime: "12:00",
          consumedTz: "UTC",
        }),
      );
      expect(created.ok).toBe(true);
      const id = created.entry?.id;
      expect(id).toBeTruthy();

      const result = await updateFoodEntry(
        { ok: false, error: null },
        formData({
          id: id ?? "",
          name: "Hijacked Name",
          quantity: "1",
          mode: "total",
          calories: "999",
          protein: "99",
          consumedDate: "2026-01-01",
          consumedTime: "12:00",
          consumedTz: "Not/AZone",
        }),
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("invalid_timezone");

      const admin = createAdminClient();
      const { data } = await admin.from("food_entries").select("*").eq("id", id ?? "").single();
      expect((data as { name: string }).name).toBe("Original Name");
    });
  });

  describe("copyFoodEntries (Phase 8 -- copy/repeat)", () => {
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

    it("copies a single entry, preserving its own local time-of-day when toTime is omitted", async () => {
      const source = await seedEntry(client, user, {
        name: "Oatmeal",
        quantity: 2,
        unit: "cup",
        caloriesPerUnit: 150,
        proteinGPerUnit: 5,
        consumedAt: "2026-01-01T08:15:00.000Z",
        consumedTz: "UTC",
      });

      const { copyFoodEntries } = await import("./food");
      const result = await copyFoodEntries({ entryIds: [source.id], toDate: "2026-01-02", toTz: "UTC" });

      expect(result.ok).toBe(true);
      expect(result.entries).toHaveLength(1);
      const copy = result.entries![0];
      expect(copy.id).not.toBe(source.id);
      expect(copy.name).toBe("Oatmeal");
      expect(copy.quantity).toBe(2);
      expect(copy.unit).toBe("cup");
      expect(copy.calories_per_unit).toBe(150);
      expect(copy.protein_g_per_unit).toBe(5);
      // Same 08:15 time-of-day, new date -- exactly what "preserve the source local time-of-day"
      // means when toTime is omitted (design doc §3.3).
      // Postgres/postgREST may echo the timestamptz back as "+00:00" rather than "Z" -- normalize
      // via Date/toISOString rather than asserting the raw string, since both encode the same instant.
      expect(new Date(copy.consumed_at).toISOString()).toBe("2026-01-02T08:15:00.000Z");
      expect(copy.consumed_tz).toBe("UTC");
    });

    it("copies a whole day (multiple ids), each preserving its own original local time-of-day", async () => {
      const breakfast = await seedEntry(client, user, {
        name: "Toast",
        caloriesPerUnit: 80,
        proteinGPerUnit: 2,
        consumedAt: "2026-01-01T08:00:00.000Z",
      });
      const lunch = await seedEntry(client, user, {
        name: "Salad",
        caloriesPerUnit: 200,
        proteinGPerUnit: 10,
        consumedAt: "2026-01-01T12:30:00.000Z",
      });

      const { copyFoodEntries } = await import("./food");
      const result = await copyFoodEntries({
        entryIds: [breakfast.id, lunch.id],
        toDate: "2026-01-05",
        toTz: "UTC",
      });

      expect(result.ok).toBe(true);
      expect(result.entries).toHaveLength(2);
      const byName = Object.fromEntries((result.entries ?? []).map((e) => [e.name, e]));
      expect(new Date(byName.Toast.consumed_at).toISOString()).toBe("2026-01-05T08:00:00.000Z");
      expect(new Date(byName.Salad.consumed_at).toISOString()).toBe("2026-01-05T12:30:00.000Z");
    });

    it("copies a meal group (shared consumed_at) onto one new shared instant -- stays grouped", async () => {
      const shared = "2026-01-01T09:00:00.000Z";
      const eggs = await seedEntry(client, user, {
        name: "Eggs",
        caloriesPerUnit: 70,
        proteinGPerUnit: 6,
        consumedAt: shared,
      });
      const toast = await seedEntry(client, user, {
        name: "Toast",
        caloriesPerUnit: 80,
        proteinGPerUnit: 2,
        consumedAt: shared,
      });

      const { copyFoodEntries } = await import("./food");
      const result = await copyFoodEntries({
        entryIds: [eggs.id, toast.id],
        toDate: "2026-01-03",
        toTz: "UTC",
      });

      expect(result.ok).toBe(true);
      expect(result.entries).toHaveLength(2);
      const instants = new Set((result.entries ?? []).map((e) => e.consumed_at));
      expect(instants.size).toBe(1);
      expect(new Date([...instants][0]).toISOString()).toBe("2026-01-03T09:00:00.000Z");
    });

    it("an explicit toTime overrides every copied row's time-of-day ('Log again')", async () => {
      const source = await seedEntry(client, user, {
        name: "Coffee",
        caloriesPerUnit: 5,
        proteinGPerUnit: 0,
        consumedAt: "2026-01-01T07:00:00.000Z",
      });

      const { copyFoodEntries } = await import("./food");
      const result = await copyFoodEntries({
        entryIds: [source.id],
        toDate: "2026-01-01",
        toTime: "14:30",
        toTz: "UTC",
      });

      expect(result.ok).toBe(true);
      expect(new Date(result.entries?.[0].consumed_at ?? "").toISOString()).toBe("2026-01-01T14:30:00.000Z");
    });

    it("drops logged_from_meal_id -- a copy is a fresh manual log, not a meal-logging event", async () => {
      const { createMeal, addMealItem, logMealForDay } = await import("./meals");

      const mealResult = await createMeal({ ok: false, error: null }, formData({ name: "Breakfast" }));
      expect(mealResult.ok).toBe(true);
      const mealId = mealResult.meal!.id;

      const itemResult = await addMealItem(
        { ok: false, error: null },
        formData({ mealId, name: "Eggs", quantity: "1", mode: "total", calories: "70", protein: "6" }),
      );
      expect(itemResult.ok).toBe(true);

      const loggedResult = await logMealForDay(
        { ok: false, error: null },
        formData({ mealId, logDate: "2026-01-01", logTime: "08:00", logTz: "UTC" }),
      );
      expect(loggedResult.ok).toBe(true);
      expect(loggedResult.entries).toHaveLength(1);
      expect(loggedResult.entries![0].logged_from_meal_id).toBe(mealId);

      const { copyFoodEntries } = await import("./food");
      const result = await copyFoodEntries({
        entryIds: [loggedResult.entries![0].id],
        toDate: "2026-01-02",
        toTz: "UTC",
      });

      expect(result.ok).toBe(true);
      expect(result.entries?.[0].logged_from_meal_id).toBeNull();
    });

    it("rejects a toDate later than today and writes no rows", async () => {
      const source = await seedEntry(client, user, {
        name: "Snack",
        caloriesPerUnit: 100,
        proteinGPerUnit: 3,
        consumedAt: "2026-01-01T10:00:00.000Z",
      });

      const { copyFoodEntries } = await import("./food");
      const result = await copyFoodEntries({
        entryIds: [source.id],
        toDate: utcTomorrow(),
        toTz: "UTC",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("future_date");

      const admin = createAdminClient();
      const { data } = await admin.from("food_entries").select("*").eq("user_id", user.id);
      // Only the original seeded source entry -- no copy was inserted.
      expect(data ?? []).toHaveLength(1);
    });

    it("rejects another user's entry id and writes zero rows for either user", async () => {
      const other = await createConfirmedTestUser();
      const otherClient = await createUserClient(other);
      const foreignEntry = await seedEntry(otherClient, other, {
        name: "Foreign Food",
        caloriesPerUnit: 50,
        proteinGPerUnit: 2,
        consumedAt: "2026-01-01T09:00:00.000Z",
      });

      currentClient = client; // back to the acting (attacker) user
      const { copyFoodEntries } = await import("./food");
      const result = await copyFoodEntries({
        entryIds: [foreignEntry.id],
        toDate: "2026-01-02",
        toTz: "UTC",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("entries_not_found");

      const admin = createAdminClient();
      const { data: callerEntries } = await admin.from("food_entries").select("*").eq("user_id", user.id);
      expect(callerEntries ?? []).toHaveLength(0);
      const { data: otherEntries } = await admin.from("food_entries").select("*").eq("user_id", other.id);
      expect(otherEntries ?? []).toHaveLength(1); // only the original, no copy

      await deleteTestUser(other.id);
    });

    it("rejects a mixed own+foreign id set wholesale, writing zero rows (not a partial copy)", async () => {
      const own = await seedEntry(client, user, {
        name: "Mine",
        caloriesPerUnit: 10,
        proteinGPerUnit: 1,
        consumedAt: "2026-01-01T09:00:00.000Z",
      });
      const other = await createConfirmedTestUser();
      const otherClient = await createUserClient(other);
      const foreignEntry = await seedEntry(otherClient, other, {
        name: "Not Mine",
        caloriesPerUnit: 20,
        proteinGPerUnit: 1,
        consumedAt: "2026-01-01T09:00:00.000Z",
      });

      currentClient = client;
      const { copyFoodEntries } = await import("./food");
      const result = await copyFoodEntries({
        entryIds: [own.id, foreignEntry.id],
        toDate: "2026-01-02",
        toTz: "UTC",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("entries_not_found");

      const admin = createAdminClient();
      const { data } = await admin.from("food_entries").select("*").eq("user_id", user.id);
      expect(data ?? []).toHaveLength(1); // only "own" -- no partial copy was created

      await deleteTestUser(other.id);
    });

    it("rejects an empty entryIds list with no_entries and writes no rows", async () => {
      const { copyFoodEntries } = await import("./food");
      const result = await copyFoodEntries({ entryIds: [], toDate: "2026-01-02", toTz: "UTC" });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("no_entries");

      const admin = createAdminClient();
      const { data } = await admin.from("food_entries").select("*").eq("user_id", user.id);
      expect(data ?? []).toHaveLength(0);
    });

    it("returns a graceful error (does not throw) for a garbled toTz, and writes no rows", async () => {
      const source = await seedEntry(client, user, {
        name: "Snack",
        caloriesPerUnit: 100,
        proteinGPerUnit: 3,
        consumedAt: "2026-01-01T10:00:00.000Z",
      });

      const { copyFoodEntries } = await import("./food");
      const result = await copyFoodEntries({
        entryIds: [source.id],
        toDate: "2026-01-02",
        toTz: "Not/AZone",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("invalid_timezone");

      const admin = createAdminClient();
      const { data } = await admin.from("food_entries").select("*").eq("user_id", user.id);
      expect(data ?? []).toHaveLength(1); // only the seeded source, no copy
    });
  });
});

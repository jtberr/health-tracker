import { test, expect } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";
import { createUserClient } from "./helpers/user-client";

/**
 * Phase 2 (Data model + RLS) developer-level DB integration coverage, per
 * docs/architecture/food-weight-tracker.md §6/§8 Phase 2: "tests exercise the DB directly, as
 * each user's JWT" — RLS isolation across all five tables + the view, DB constraints, generated-
 * total integrity, and trigger-derived consumed_local_date. There is no UI/server-action layer
 * yet (that's Phase 3+), so these talk to Postgres/PostgREST directly via anon-key clients signed
 * in as two independent test users — no browser `page` fixture is used.
 *
 * Requires `npx supabase start` running locally (or an equivalent CI service, wired in
 * .github/workflows/ci.yml) plus the env vars in .env.example, including
 * SUPABASE_SERVICE_ROLE_KEY (used only by e2e/helpers/* to create/delete test users). Actually
 * run against a live local Supabase instance during development of this migration — see the
 * implementation report for confirmation.
 *
 * This is the developer's own coverage of this phase's scope; qa-reviewer independently writes
 * and runs its own adversarial acceptance tests from the spec per the project workflow.
 */

test.describe.configure({ mode: "serial" });

test.describe("Phase 2 — schema, RLS, and constraints", () => {
  let userA: TestUser;
  let userB: TestUser;
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;

  test.beforeAll(async () => {
    userA = await createConfirmedTestUser();
    userB = await createConfirmedTestUser();
    clientA = await createUserClient(userA);
    clientB = await createUserClient(userB);
  });

  test.afterAll(async () => {
    // ON DELETE CASCADE on every table's user_id FK cleans up all fixture rows created below.
    await deleteTestUser(userA.id);
    await deleteTestUser(userB.id);
  });

  function baseFoodEntry(userId: string, overrides: Record<string, unknown> = {}) {
    return {
      user_id: userId,
      name: "Test food",
      calories_per_unit: 100,
      protein_g_per_unit: 10,
      consumed_at: new Date().toISOString(),
      consumed_tz: "UTC",
      ...overrides,
    };
  }

  // -----------------------------------------------------------------------------------------
  // RLS isolation
  // -----------------------------------------------------------------------------------------

  test.describe("RLS isolation", () => {
    test("food_entries: owner sees it, another user cannot", async () => {
      const { data: inserted, error: insertError } = await clientA
        .from("food_entries")
        .insert(baseFoodEntry(userA.id, { name: "Apple" }))
        .select()
        .single();
      expect(insertError).toBeNull();
      expect(inserted?.id).toBeTruthy();

      const { data: seenByOwner } = await clientA
        .from("food_entries")
        .select("id")
        .eq("id", inserted.id);
      expect(seenByOwner).toHaveLength(1);

      const { data: seenByOther, error: otherError } = await clientB
        .from("food_entries")
        .select("id")
        .eq("id", inserted.id);
      expect(otherError).toBeNull();
      expect(seenByOther).toEqual([]);
    });

    test("food_entries: another user's update/delete affects zero rows", async () => {
      const { data: inserted } = await clientA
        .from("food_entries")
        .insert(baseFoodEntry(userA.id, { name: "Untouched" }))
        .select()
        .single();

      const { data: updateResult, error: updateError } = await clientB
        .from("food_entries")
        .update({ name: "Hacked" })
        .eq("id", inserted.id)
        .select();
      expect(updateError).toBeNull();
      expect(updateResult).toEqual([]);

      const { data: stillOriginal } = await clientA
        .from("food_entries")
        .select("name")
        .eq("id", inserted.id)
        .single();
      expect(stillOriginal?.name).toBe("Untouched");

      const { data: deleteResult, error: deleteError } = await clientB
        .from("food_entries")
        .delete()
        .eq("id", inserted.id)
        .select();
      expect(deleteError).toBeNull();
      expect(deleteResult).toEqual([]);
    });

    test("food_entries: cannot insert a row impersonating another user's user_id", async () => {
      const { error } = await clientA
        .from("food_entries")
        .insert(baseFoodEntry(userB.id, { name: "Impersonation attempt" }));
      expect(error).not.toBeNull();
    });

    test("meals + meal_items: another user cannot read, write, or impersonate", async () => {
      const { data: meal, error: mealError } = await clientA
        .from("meals")
        .insert({ user_id: userA.id, name: "Alice's meal" })
        .select()
        .single();
      expect(mealError).toBeNull();

      const { data: item, error: itemError } = await clientA
        .from("meal_items")
        .insert({
          meal_id: meal.id,
          user_id: userA.id,
          name: "Egg",
          calories_per_unit: 70,
          protein_g_per_unit: 6,
        })
        .select()
        .single();
      expect(itemError).toBeNull();

      const { data: mealSeenByOther } = await clientB.from("meals").select("id").eq("id", meal.id);
      expect(mealSeenByOther).toEqual([]);

      const { data: itemSeenByOther } = await clientB
        .from("meal_items")
        .select("id")
        .eq("id", item.id);
      expect(itemSeenByOther).toEqual([]);

      const { error: impersonationError } = await clientB
        .from("meals")
        .insert({ user_id: userA.id, name: "Impersonation attempt" });
      expect(impersonationError).not.toBeNull();
    });

    test("daily_metrics: another user cannot read or write", async () => {
      const metricDate = "2026-06-01";
      const { data: metric, error: metricError } = await clientA
        .from("daily_metrics")
        .insert({ user_id: userA.id, metric_date: metricDate, weight_kg: 70 })
        .select()
        .single();
      expect(metricError).toBeNull();

      const { data: seenByOther } = await clientB
        .from("daily_metrics")
        .select("id")
        .eq("id", metric.id);
      expect(seenByOther).toEqual([]);

      const { error: impersonationError } = await clientB
        .from("daily_metrics")
        .insert({ user_id: userA.id, metric_date: "2026-06-02", weight_kg: 999 });
      expect(impersonationError).not.toBeNull();
    });

    test("user_goals: another user cannot read or write", async () => {
      const { error: insertError } = await clientA
        .from("user_goals")
        .insert({ user_id: userA.id, daily_calorie_target: 2200 });
      expect(insertError).toBeNull();

      const { data: seenByOther } = await clientB
        .from("user_goals")
        .select("user_id")
        .eq("user_id", userA.id);
      expect(seenByOther).toEqual([]);

      const { error: impersonationError } = await clientB
        .from("user_goals")
        .insert({ user_id: userA.id, daily_calorie_target: 1 });
      expect(impersonationError).not.toBeNull();
    });

    test("daily_food_totals view: rows are scoped per-user via security_invoker", async () => {
      const consumedAt = new Date().toISOString();
      await clientA
        .from("food_entries")
        .insert(baseFoodEntry(userA.id, { name: "View-scoped entry", consumed_at: consumedAt }))
        .select()
        .single();

      const { data: ownTotals, error: ownError } = await clientA
        .from("daily_food_totals")
        .select("user_id");
      expect(ownError).toBeNull();
      expect(ownTotals?.every((row: { user_id: string }) => row.user_id === userA.id)).toBe(true);
      expect(ownTotals?.length).toBeGreaterThan(0);

      const { data: otherTotals, error: otherError } = await clientB
        .from("daily_food_totals")
        .select("user_id")
        .eq("user_id", userA.id);
      expect(otherError).toBeNull();
      expect(otherTotals).toEqual([]);
    });
  });

  // -----------------------------------------------------------------------------------------
  // DB constraints
  // -----------------------------------------------------------------------------------------

  test.describe("DB constraints", () => {
    test("rejects non-positive quantity", async () => {
      const { error } = await clientA
        .from("food_entries")
        .insert(baseFoodEntry(userA.id, { quantity: 0 }));
      expect(error?.code).toBe("23514"); // check_violation
    });

    test("rejects negative calories_per_unit and protein_g_per_unit", async () => {
      const { error: caloriesError } = await clientA
        .from("food_entries")
        .insert(baseFoodEntry(userA.id, { calories_per_unit: -1 }));
      expect(caloriesError?.code).toBe("23514");

      const { error: proteinError } = await clientA
        .from("food_entries")
        .insert(baseFoodEntry(userA.id, { protein_g_per_unit: -1 }));
      expect(proteinError?.code).toBe("23514");
    });

    test("rejects an empty name", async () => {
      const { error } = await clientA.from("food_entries").insert(baseFoodEntry(userA.id, { name: "   " }));
      expect(error?.code).toBe("23514");
    });

    test("rejects an empty consumed_tz", async () => {
      const { error } = await clientA
        .from("food_entries")
        .insert(baseFoodEntry(userA.id, { consumed_tz: "" }));
      // The set_consumed_local_date trigger's `consumed_at AT TIME ZONE consumed_tz` runs before
      // the column CHECK constraint is evaluated, and Postgres rejects '' as an invalid zone name
      // at that point (22023 invalid_parameter_value) rather than ever reaching the 23514
      // check_violation the non-empty-string CHECK would otherwise raise. Either way the empty
      // value is rejected, which is what this test actually asserts.
      expect(error?.code).toBe("22023");
    });

    test("rejects a null consumed_at", async () => {
      const { error } = await clientA
        .from("food_entries")
        .insert(baseFoodEntry(userA.id, { consumed_at: null }));
      expect(error?.code).toBe("23502"); // not_null_violation
    });

    test("rejects a future-dated local day (no-future-day cap)", async () => {
      const tomorrowUtc = new Date(Date.now() + 26 * 60 * 60 * 1000).toISOString();
      const { error } = await clientA
        .from("food_entries")
        .insert(baseFoodEntry(userA.id, { consumed_at: tomorrowUtc, consumed_tz: "UTC" }));
      expect(error?.code).toBe("23514");
      expect(error?.message).toContain("food_entries_not_future_day");
    });

    test("accepts a same-local-day entry right up to 'now'", async () => {
      const { error } = await clientA
        .from("food_entries")
        .insert(baseFoodEntry(userA.id, { consumed_at: new Date().toISOString(), consumed_tz: "UTC" }));
      expect(error).toBeNull();
    });

    test("rejects a grossly future metric_date on daily_metrics", async () => {
      const farFuture = new Date();
      farFuture.setDate(farFuture.getDate() + 10);
      const { error } = await clientA.from("daily_metrics").insert({
        user_id: userA.id,
        metric_date: farFuture.toISOString().slice(0, 10),
        weight_kg: 70,
      });
      expect(error?.code).toBe("23514");
      expect(error?.message).toContain("daily_metrics_not_future_day");
    });

    test("the daily_metrics future cap is deliberately loose by one day", async () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const { error } = await clientA.from("daily_metrics").insert({
        user_id: userA.id,
        metric_date: tomorrow.toISOString().slice(0, 10),
        weight_kg: 70,
      });
      expect(error).toBeNull();
    });

    test("rejects non-positive weight_kg", async () => {
      const { error } = await clientA
        .from("daily_metrics")
        .insert({ user_id: userA.id, metric_date: "2026-05-01", weight_kg: 0 });
      expect(error?.code).toBe("23514");
    });

    test("rejects an out-of-range body_fat_pct", async () => {
      const { error } = await clientA.from("daily_metrics").insert({
        user_id: userA.id,
        metric_date: "2026-05-02",
        weight_kg: 70,
        body_fat_pct: 150,
      });
      expect(error?.code).toBe("23514");
    });

    test("enforces one daily_metrics row per user per day (unique constraint)", async () => {
      const metricDate = "2026-05-03";
      const { error: firstError } = await clientA
        .from("daily_metrics")
        .insert({ user_id: userA.id, metric_date: metricDate, weight_kg: 70 });
      expect(firstError).toBeNull();

      const { error: secondError } = await clientA
        .from("daily_metrics")
        .insert({ user_id: userA.id, metric_date: metricDate, weight_kg: 71 });
      expect(secondError?.code).toBe("23505"); // unique_violation
    });

    test("rejects an invalid weight_unit on user_goals", async () => {
      const { error } = await clientB
        .from("user_goals")
        .insert({ user_id: userB.id, weight_unit: "stone" });
      expect(error?.code).toBe("23514");
    });

    test("cross-user meal_item: user_id must match the meal's own owner", async () => {
      const { data: meal } = await clientA
        .from("meals")
        .insert({ user_id: userA.id, name: "Alice's other meal" })
        .select()
        .single();

      // clientB inserts a meal_item that satisfies its OWN RLS check (user_id = auth.uid() = B)
      // but points meal_id at a meal A owns — the composite FK (meal_id, user_id) -> meals(id,
      // user_id) has no matching (meal.id, B) tuple, so this must fail regardless of RLS.
      const { error } = await clientB.from("meal_items").insert({
        meal_id: meal.id,
        user_id: userB.id,
        name: "Cross-user item",
        calories_per_unit: 50,
        protein_g_per_unit: 2,
      });
      expect(error?.code).toBe("23503"); // foreign_key_violation
    });
  });

  // -----------------------------------------------------------------------------------------
  // Generated total integrity
  // -----------------------------------------------------------------------------------------

  test.describe("generated totals", () => {
    test("calories/protein_g cannot be set directly", async () => {
      const { error } = await clientA
        .from("food_entries")
        .insert(baseFoodEntry(userA.id, { calories: 9999 }));
      expect(error).not.toBeNull();
    });

    test("calories/protein_g equal round(quantity x per-unit) and recompute on quantity edit", async () => {
      const { data: inserted, error: insertError } = await clientA
        .from("food_entries")
        .insert(
          baseFoodEntry(userA.id, {
            name: "Quantity math",
            quantity: 3,
            calories_per_unit: 33.33,
            // protein_g_per_unit is numeric(10,2) — a 2-decimal input avoids any ambiguity from
            // the column itself rounding a higher-precision input before this test's own math.
            protein_g_per_unit: 2.35,
          }),
        )
        .select()
        .single();
      expect(insertError).toBeNull();
      expect(inserted.calories).toBe(100); // round(3 * 33.33) = round(99.99) = 100
      expect(Number(inserted.protein_g)).toBeCloseTo(7.05, 2); // round(3 * 2.35, 2) = 7.05

      const { data: updated, error: updateError } = await clientA
        .from("food_entries")
        .update({ quantity: 5 })
        .eq("id", inserted.id)
        .select()
        .single();
      expect(updateError).toBeNull();
      expect(updated.calories).toBe(167); // round(5 * 33.33) = round(166.65) = 167
    });

    test("meal_items totals are generated the same way", async () => {
      const { data: meal } = await clientA
        .from("meals")
        .insert({ user_id: userA.id, name: "Totals meal" })
        .select()
        .single();

      const { data: item, error } = await clientA
        .from("meal_items")
        .insert({
          meal_id: meal.id,
          user_id: userA.id,
          name: "Oats",
          quantity: 2,
          calories_per_unit: 150,
          protein_g_per_unit: 5,
        })
        .select()
        .single();
      expect(error).toBeNull();
      expect(item.calories).toBe(300);
      expect(Number(item.protein_g)).toBe(10);
    });
  });

  // -----------------------------------------------------------------------------------------
  // consumed_local_date trigger derivation
  // -----------------------------------------------------------------------------------------

  test.describe("consumed_local_date derivation", () => {
    test("derives the local date from consumed_at + consumed_tz", async () => {
      const { data, error } = await clientA
        .from("food_entries")
        .insert(
          baseFoodEntry(userA.id, {
            consumed_at: "2026-03-15T12:00:00Z",
            consumed_tz: "UTC",
          }),
        )
        .select()
        .single();
      expect(error).toBeNull();
      expect(data.consumed_local_date).toBe("2026-03-15");
    });

    test("near-midnight UTC rolls to the next local day in a positive-offset timezone", async () => {
      // 23:30 UTC on the 14th is 2026-03-15 in a UTC+14 zone (Pacific/Kiritimati).
      const { data, error } = await clientA
        .from("food_entries")
        .insert(
          baseFoodEntry(userA.id, {
            consumed_at: "2026-03-14T23:30:00Z",
            consumed_tz: "Pacific/Kiritimati",
          }),
        )
        .select()
        .single();
      expect(error).toBeNull();
      expect(data.consumed_local_date).toBe("2026-03-15");
    });

    test("near-midnight UTC rolls to the previous local day in a negative-offset timezone", async () => {
      // 02:00 UTC on the 15th is still 2026-03-14 evening in America/Los_Angeles (UTC-7/8).
      const { data, error } = await clientA
        .from("food_entries")
        .insert(
          baseFoodEntry(userA.id, {
            consumed_at: "2026-03-15T02:00:00Z",
            consumed_tz: "America/Los_Angeles",
          }),
        )
        .select()
        .single();
      expect(error).toBeNull();
      expect(data.consumed_local_date).toBe("2026-03-14");
    });

    test("the same UTC instant yields different local dates for a travelling user", async () => {
      const instant = "2026-03-01T23:00:00Z";
      const { data: tokyo, error: tokyoError } = await clientA
        .from("food_entries")
        .insert(baseFoodEntry(userA.id, { consumed_at: instant, consumed_tz: "Asia/Tokyo" }))
        .select()
        .single();
      expect(tokyoError).toBeNull();

      const { data: newYork, error: newYorkError } = await clientA
        .from("food_entries")
        .insert(baseFoodEntry(userA.id, { consumed_at: instant, consumed_tz: "America/New_York" }))
        .select()
        .single();
      expect(newYorkError).toBeNull();

      expect(tokyo.consumed_local_date).not.toBe(newYork.consumed_local_date);
      expect(tokyo.consumed_local_date).toBe("2026-03-02");
      expect(newYork.consumed_local_date).toBe("2026-03-01");
    });

    test("updating consumed_tz alone recomputes consumed_local_date", async () => {
      const { data: inserted } = await clientA
        .from("food_entries")
        .insert(
          baseFoodEntry(userA.id, {
            consumed_at: "2026-03-15T02:00:00Z",
            consumed_tz: "UTC",
          }),
        )
        .select()
        .single();
      expect(inserted.consumed_local_date).toBe("2026-03-15");

      const { data: updated, error } = await clientA
        .from("food_entries")
        .update({ consumed_tz: "America/Los_Angeles" })
        .eq("id", inserted.id)
        .select()
        .single();
      expect(error).toBeNull();
      expect(updated.consumed_local_date).toBe("2026-03-14");
    });
  });
});

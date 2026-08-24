import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "../../../e2e/helpers/test-users";
import { createUserClient } from "../../../e2e/helpers/user-client";
import { createAdminClient } from "../../../e2e/helpers/admin-client";
import type { Meal, MealItem } from "@/lib/types";

/**
 * QA-REVIEWER independent Phase 8f action-level suite -- "Saved meals: pinning and duplicating".
 *
 * Written from docs/architecture/food-weight-tracker.md 3.3 (`setMealPinned`/`duplicateMeal`),
 * 3.4's "Pinned meals and duplicating a meal" block, 6's matching acceptance rows and 8's Phase 8f
 * section -- NOT from the developer's own meals.test.ts, read only afterwards to look for gaps.
 *
 * Uses the repo's established real-Postgres/RLS harness (mock `@/lib/supabase/server`'s
 * createClient to return a REAL anon-key client signed in as a specific test user), because the
 * three rows 6 says to hammer -- RLS on the new column, sort_order preservation, and a
 * byte-identical source -- are all action-level facts that the UI cannot reach (there is no way to
 * point the pin toggle at another user's meal from the browser).
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
  console.warn("[meals-pinning.qa.test.ts] Skipping: Supabase env not set (see meals.test.ts).");
}

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

function psql(sql: string): string {
  return execFileSync(
    "docker",
    ["exec", "supabase_db_health-tracker", "psql", "-U", "postgres", "-d", "postgres", "-At", "-c", sql],
    { encoding: "utf8" },
  ).trim();
}

describe.skipIf(!hasSupabaseEnv)("Phase 8f -- migration + RLS, verified BY QUERY not by reading SQL", () => {
  it("meals.is_pinned is boolean NOT NULL DEFAULT false", () => {
    const row = psql(
      "select data_type||'|'||is_nullable||'|'||coalesce(column_default,'') from information_schema.columns " +
        "where table_schema='public' and table_name='meals' and column_name='is_pinned'",
    );
    expect(row).toBe("boolean|NO|false");
  });

  it("RLS is still ENABLED on meals and the four policies are unchanged", () => {
    expect(psql("select relrowsecurity from pg_class where relname='meals'")).toBe("t");

    const policies = psql(
      "select policyname||'|'||cmd||'|'||coalesce(qual,'')||'|'||coalesce(with_check,'') " +
        "from pg_policies where schemaname='public' and tablename='meals' order by policyname",
    ).split("\n");
    expect(policies).toHaveLength(4);
    const uid = "(user_id = ( SELECT auth.uid() AS uid))";
    expect(policies[0]).toBe("meals_delete_own|DELETE|" + uid + "|");
    expect(policies[1]).toBe("meals_insert_own|INSERT||" + uid);
    expect(policies[2]).toBe("meals_select_own|SELECT|" + uid + "|");
    // The load-bearing one for this phase: an is_pinned UPDATE is constrained on BOTH sides.
    expect(policies[3]).toBe("meals_update_own|UPDATE|" + uid + "|" + uid);
  });

  it("the anon role still has no read/write grant on meals (AGENTS.md Absolute Rule)", () => {
    const grants = psql(
      "select coalesce(string_agg(privilege_type, ',' order by privilege_type), '') " +
        "from information_schema.role_table_grants where table_schema='public' and table_name='meals' " +
        "and grantee='anon' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')",
    );
    expect(grants).toBe("");
  });

  it("every pre-existing row was filled with false by the ALTER (no separate backfill needed)", () => {
    expect(psql("select count(*) from public.meals where is_pinned is null")).toBe("0");
  });
});

describe.skipIf(!hasSupabaseEnv)("Phase 8f -- setMealPinned and duplicateMeal against real RLS", () => {
  let alice: TestUser;
  let bob: TestUser;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;
  let admin: SupabaseClient;

  beforeAll(async () => {
    alice = await createConfirmedTestUser();
    bob = await createConfirmedTestUser();
    aliceClient = await createUserClient(alice);
    bobClient = await createUserClient(bob);
    admin = createAdminClient();
  }, 60000);

  afterAll(async () => {
    if (alice) await deleteTestUser(alice.id);
    if (bob) await deleteTestUser(bob.id);
  });

  async function seedMeal(
    owner: TestUser,
    client: SupabaseClient,
    name: string,
    items: Array<{ name: string; sortOrder: number; quantity?: number; cal: number; prot: number }> = [],
  ): Promise<Meal> {
    const { data, error } = await client
      .from("meals")
      .insert({ user_id: owner.id, name })
      .select()
      .single();
    if (error || !data) throw new Error("seedMeal failed: " + (error?.message ?? "no data"));
    for (const item of items) {
      const { error: e } = await client.from("meal_items").insert({
        meal_id: data.id,
        user_id: owner.id,
        name: item.name,
        quantity: item.quantity ?? 1,
        unit: null,
        calories_per_unit: item.cal,
        protein_g_per_unit: item.prot,
        sort_order: item.sortOrder,
      });
      if (e) throw new Error("seed item failed: " + e.message);
    }
    return data as Meal;
  }

  async function adminMeal(id: string): Promise<Meal | null> {
    const { data } = await admin.from("meals").select("*").eq("id", id).maybeSingle();
    return (data as Meal) ?? null;
  }

  async function adminItems(mealId: string): Promise<MealItem[]> {
    const { data } = await admin
      .from("meal_items")
      .select("*")
      .eq("meal_id", mealId)
      .order("sort_order", { ascending: true });
    return (data ?? []) as MealItem[];
  }

  it("THE ROW TO HAMMER: user B cannot pin user A's meal -- A's row is untouched", async () => {
    const { setMealPinned } = await import("./meals");
    const aliceMeal = await seedMeal(alice, aliceClient, "QA8f Alice Private");
    expect((await adminMeal(aliceMeal.id))!.is_pinned).toBe(false);

    currentClient = bobClient;
    await setMealPinned(aliceMeal.id, true);

    // Proven by a SERVICE-ROLE read, not by the action's own return value.
    expect((await adminMeal(aliceMeal.id))!.is_pinned).toBe(false);

    // ...and the owner CAN pin it, so the negative above isn't vacuous.
    currentClient = aliceClient;
    const ok = await setMealPinned(aliceMeal.id, true);
    expect(ok.ok).toBe(true);
    expect((await adminMeal(aliceMeal.id))!.is_pinned).toBe(true);

    // Unpinning reverses it.
    await setMealPinned(aliceMeal.id, false);
    expect((await adminMeal(aliceMeal.id))!.is_pinned).toBe(false);
  });

  it("setMealPinned changes ONLY is_pinned -- name/created_at are untouched", async () => {
    const { setMealPinned } = await import("./meals");
    const m = await seedMeal(alice, aliceClient, "QA8f Untouched");
    const before = (await adminMeal(m.id))!;

    currentClient = aliceClient;
    await setMealPinned(m.id, true);
    const after = (await adminMeal(m.id))!;

    expect(after.name).toBe(before.name);
    expect(after.created_at).toBe(before.created_at);
    expect(after.user_id).toBe(before.user_id);
    expect(after.is_pinned).toBe(true);
  });

  it("THE ROW TO HAMMER: duplicateMeal PRESERVES non-contiguous sort_order (0/2/5), never renumbers", async () => {
    const { duplicateMeal } = await import("./meals");
    const source = await seedMeal(alice, aliceClient, "QA8f Ordered", [
      { name: "First", sortOrder: 0, cal: 100, prot: 10 },
      { name: "Second", sortOrder: 2, cal: 200, prot: 20 },
      { name: "Third", sortOrder: 5, cal: 300, prot: 30 },
    ]);

    currentClient = aliceClient;
    const result = await duplicateMeal(
      { ok: false, error: null },
      formData({ mealId: source.id, name: "QA8f Ordered (copy)" }),
    );
    expect(result.ok).toBe(true);
    const copy = result.meal!;

    const copied = await adminItems(copy.id);
    // 0/2/5 is chosen precisely so an implementation that mechanically reused
    // mealItemsFromEntries' 0..N-1 renumbering fails here rather than coincidentally passing.
    expect(copied.map((i) => i.sort_order)).toEqual([0, 2, 5]);
    expect(copied.map((i) => i.name)).toEqual(["First", "Second", "Third"]);

    const sourceItems = await adminItems(source.id);
    expect(copied.map((i) => i.calories_per_unit)).toEqual(sourceItems.map((i) => i.calories_per_unit));
    expect(copied.map((i) => i.protein_g_per_unit)).toEqual(sourceItems.map((i) => i.protein_g_per_unit));
    expect(copied.map((i) => i.quantity)).toEqual(sourceItems.map((i) => i.quantity));
    // Totals equal BY CONSTRUCTION -- the generated columns are never copied, they are recomputed.
    const sum = (items: MealItem[]) => items.reduce((a, i) => a + Number(i.calories), 0);
    expect(sum(copied)).toBe(sum(sourceItems));
    // Fresh identity, correct parentage.
    for (const i of copied) {
      expect(i.meal_id).toBe(copy.id);
      expect(i.user_id).toBe(alice.id);
      expect(sourceItems.map((s) => s.id)).not.toContain(i.id);
    }
  });

  it("THE ROW TO HAMMER: the source meal and its items are BYTE-IDENTICAL afterwards, updated_at included", async () => {
    const { duplicateMeal } = await import("./meals");
    const source = await seedMeal(alice, aliceClient, "QA8f Readonly", [
      { name: "Egg", sortOrder: 0, quantity: 3, cal: 70, prot: 6 },
      { name: "Toast", sortOrder: 1, quantity: 2, cal: 90, prot: 3 },
    ]);
    const mealBefore = await adminMeal(source.id);
    const itemsBefore = await adminItems(source.id);

    currentClient = aliceClient;
    const result = await duplicateMeal(
      { ok: false, error: null },
      formData({ mealId: source.id, name: "QA8f Readonly (copy)" }),
    );
    expect(result.ok).toBe(true);

    // Full-row deep equality catches ANY column, and updated_at specifically proves no UPDATE fired.
    expect(await adminMeal(source.id)).toEqual(mealBefore);
    expect(await adminItems(source.id)).toEqual(itemsBefore);
  });

  it("the duplicate is NOT pinned even when the source is", async () => {
    const { duplicateMeal, setMealPinned } = await import("./meals");
    const source = await seedMeal(alice, aliceClient, "QA8f Pinned Source", [
      { name: "Item", sortOrder: 0, cal: 100, prot: 10 },
    ]);
    currentClient = aliceClient;
    await setMealPinned(source.id, true);
    expect((await adminMeal(source.id))!.is_pinned).toBe(true);

    const result = await duplicateMeal(
      { ok: false, error: null },
      formData({ mealId: source.id, name: "QA8f Pinned Source (copy)" }),
    );
    expect(result.ok).toBe(true);
    expect((await adminMeal(result.meal!.id))!.is_pinned).toBe(false);
    // ...and the source keeps its pin.
    expect((await adminMeal(source.id))!.is_pinned).toBe(true);
  });
});

describe.skipIf(!hasSupabaseEnv)("Phase 8f -- duplicateMeal ownership, validation and atomicity", () => {
  let alice: TestUser;
  let bob: TestUser;
  let aliceClient: SupabaseClient;
  let bobClient: SupabaseClient;
  let admin: SupabaseClient;

  beforeAll(async () => {
    alice = await createConfirmedTestUser();
    bob = await createConfirmedTestUser();
    aliceClient = await createUserClient(alice);
    bobClient = await createUserClient(bob);
    admin = createAdminClient();
  }, 60000);

  afterAll(async () => {
    if (alice) await deleteTestUser(alice.id);
    if (bob) await deleteTestUser(bob.id);
  });

  async function seedMeal(owner: TestUser, client: SupabaseClient, name: string, itemCount = 1) {
    const { data, error } = await client
      .from("meals")
      .insert({ user_id: owner.id, name })
      .select()
      .single();
    if (error || !data) throw new Error("seedMeal failed");
    for (let i = 0; i < itemCount; i++) {
      await client.from("meal_items").insert({
        meal_id: data.id,
        user_id: owner.id,
        name: "Item " + i,
        quantity: 1,
        unit: null,
        calories_per_unit: 100,
        protein_g_per_unit: 10,
        sort_order: i,
      });
    }
    return data as Meal;
  }

  async function countMeals(userId: string): Promise<number> {
    const { data } = await admin.from("meals").select("id").eq("user_id", userId);
    return (data ?? []).length;
  }

  it("another user's mealId -> meal_not_found, with ZERO rows written for either user", async () => {
    const { duplicateMeal } = await import("./meals");
    const aliceMeal = await seedMeal(alice, aliceClient, "QA8f Alice Secret", 2);
    const beforeAlice = await countMeals(alice.id);
    const beforeBob = await countMeals(bob.id);

    currentClient = bobClient;
    const result = await duplicateMeal(
      { ok: false, error: null },
      formData({ mealId: aliceMeal.id, name: "Stolen" }),
    );

    expect(result.ok).toBe(false);
    expect(result.error).toBe("meal_not_found");
    expect(await countMeals(alice.id)).toBe(beforeAlice);
    expect(await countMeals(bob.id)).toBe(beforeBob);
  });

  it("a nonexistent mealId is INDISTINGUISHABLE from a foreign one (no enumeration oracle)", async () => {
    const { duplicateMeal } = await import("./meals");
    currentClient = bobClient;
    const result = await duplicateMeal(
      { ok: false, error: null },
      formData({ mealId: "00000000-0000-0000-0000-000000000000", name: "Ghost" }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe("meal_not_found");
  });

  it("a blank / whitespace-only name is a FIELD error and writes zero rows", async () => {
    const { duplicateMeal } = await import("./meals");
    const source = await seedMeal(alice, aliceClient, "QA8f Blank Name Source");
    const before = await countMeals(alice.id);

    currentClient = aliceClient;
    for (const name of ["", "   "]) {
      const result = await duplicateMeal({ ok: false, error: null }, formData({ mealId: source.id, name }));
      expect(result.ok).toBe(false);
      expect(result.fieldErrors?.name).toBeTruthy();
      expect(await countMeals(alice.id)).toBe(before);
    }
  });

  it("an EMPTY source meal duplicates successfully, and the copy is still refused by logMealForDay", async () => {
    const { duplicateMeal, logMealForDay } = await import("./meals");
    const empty = await seedMeal(alice, aliceClient, "QA8f Empty", 0);

    currentClient = aliceClient;
    const result = await duplicateMeal(
      { ok: false, error: null },
      formData({ mealId: empty.id, name: "QA8f Empty (copy)" }),
    );
    // Deliberately NOT rejected the way createMealFromEntries rejects no_entries (3.3).
    expect(result.ok).toBe(true);
    const { data: items } = await admin.from("meal_items").select("id").eq("meal_id", result.meal!.id);
    expect(items ?? []).toHaveLength(0);

    // ...and nothing downstream is at risk.
    const logged = await logMealForDay(
      { ok: false, error: null },
      formData({
        mealId: result.meal!.id,
        logDate: new Date().toISOString().slice(0, 10),
        logTime: "12:00",
        logTz: "UTC",
      }),
    );
    expect(logged.ok).toBe(false);
    expect(logged.error).toBe("empty_meal");
  });

  it("independence in BOTH directions: editing/deleting either side leaves the other untouched", async () => {
    const { duplicateMeal, updateMeal, deleteMeal } = await import("./meals");
    const source = await seedMeal(alice, aliceClient, "QA8f Independent", 2);

    currentClient = aliceClient;
    const result = await duplicateMeal(
      { ok: false, error: null },
      formData({ mealId: source.id, name: "QA8f Independent (copy)" }),
    );
    const copyId = result.meal!.id;

    // Rename the COPY -> source unchanged.
    await updateMeal({ ok: false, error: null }, formData({ mealId: copyId, name: "Renamed copy" }));
    const { data: srcAfter } = await admin.from("meals").select("name").eq("id", source.id).single();
    expect(srcAfter!.name).toBe("QA8f Independent");

    // Delete the COPY -> source and its items survive intact.
    await deleteMeal(copyId);
    const { data: stillThere } = await admin.from("meals").select("id").eq("id", source.id).maybeSingle();
    expect(stillThere).toBeTruthy();
    const { data: srcItems } = await admin.from("meal_items").select("id").eq("meal_id", source.id);
    expect(srcItems ?? []).toHaveLength(2);
  });

  it("COMPENSATING DELETE: a forced meal_items insert failure leaves NO orphan meals row", async () => {
    const { duplicateMeal } = await import("./meals");
    const source = await seedMeal(alice, aliceClient, "QA8f Atomic", 2);
    const before = await countMeals(alice.id);

    // Fault injection, the same docker-exec trigger technique e2e/phase7b-acceptance.spec.ts
    // established. A distinct trigger name so it can never collide with that suite's own.
    psql(
      "create or replace function qa8f_block_items() returns trigger language plpgsql as " +
        "$$ begin raise exception 'qa8f forced failure'; end; $$;",
    );
    psql(
      "create trigger qa8f_block_items before insert on public.meal_items " +
        "for each row execute function qa8f_block_items();",
    );
    try {
      currentClient = aliceClient;
      const result = await duplicateMeal(
        { ok: false, error: null },
        formData({ mealId: source.id, name: "QA8f Atomic (copy)" }),
      );
      expect(result.ok).toBe(false);
      // The just-created meals row was rolled back by the compensating delete.
      expect(await countMeals(alice.id)).toBe(before);
    } finally {
      psql("drop trigger if exists qa8f_block_items on public.meal_items");
      psql("drop function if exists qa8f_block_items()");
    }

    // NEGATIVE CONTROL: without the trigger the same call succeeds, so the assertion above cannot
    // be passing merely because duplication is broken in general.
    currentClient = aliceClient;
    const ok = await duplicateMeal(
      { ok: false, error: null },
      formData({ mealId: source.id, name: "QA8f Atomic (copy)" }),
    );
    expect(ok.ok).toBe(true);
    expect(await countMeals(alice.id)).toBe(before + 1);
  });
});

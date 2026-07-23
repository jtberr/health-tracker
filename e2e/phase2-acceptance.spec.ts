/**
 * Phase 2 - INDEPENDENT QA acceptance suite, written from the design doc spec (NOT derived from
 * the developer db-schema.spec.ts). Exercises the DB as each user RLS-scoped anon JWT.
 */
import { test, expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "./helpers/test-users";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL as string;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string;

let userA: TestUser;
let userB: TestUser;
let clientA: SupabaseClient;
let clientB: SupabaseClient;

async function signedInClient(u: TestUser): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password });
  if (error) throw new Error("sign-in " + u.email + ": " + error.message);
  return c;
}

test.beforeAll(async () => {
  userA = await createConfirmedTestUser();
  userB = await createConfirmedTestUser();
  clientA = await signedInClient(userA);
  clientB = await signedInClient(userB);
});

test.afterAll(async () => {
  if (userA) await deleteTestUser(userA.id);
  if (userB) await deleteTestUser(userB.id);
});

function foodPayload(userId: string, over: Record<string, unknown> = {}) {
  return {
    user_id: userId,
    name: "Test food",
    quantity: 2,
    unit: "serving",
    calories_per_unit: 100,
    protein_g_per_unit: 10,
    consumed_at: "2026-07-15T12:00:00Z",
    consumed_tz: "America/New_York",
    ...over,
  };
}

// ---- RLS ISOLATION (critical) ----

test("RLS: user cannot read a foreign user food_entries", async () => {
  const ins = await clientA.from("food_entries").insert(foodPayload(userA.id)).select().single();
  expect(ins.error).toBeNull();
  const rowId = ins.data.id;
  const bRead = await clientB.from("food_entries").select("*").eq("id", rowId);
  expect(bRead.error).toBeNull();
  expect(bRead.data).toEqual([]);
  const aRead = await clientA.from("food_entries").select("*").eq("id", rowId);
  expect(aRead.data).toHaveLength(1);
});

test("RLS: user cannot UPDATE a foreign user food_entries", async () => {
  const ins = await clientA.from("food_entries").insert(foodPayload(userA.id, { name: "orig" })).select().single();
  const rowId = ins.data.id;
  const upd = await clientB.from("food_entries").update({ name: "hijacked" }).eq("id", rowId).select();
  expect(upd.error).toBeNull();
  expect(upd.data).toEqual([]);
  const check = await clientA.from("food_entries").select("name").eq("id", rowId).single();
  expect(check.data!.name).toBe("orig");
});

test("RLS: user cannot DELETE a foreign user food_entries", async () => {
  const ins = await clientA.from("food_entries").insert(foodPayload(userA.id)).select().single();
  const rowId = ins.data.id;
  const del = await clientB.from("food_entries").delete().eq("id", rowId).select();
  expect(del.error).toBeNull();
  expect(del.data).toEqual([]);
  const check = await clientA.from("food_entries").select("id").eq("id", rowId);
  expect(check.data).toHaveLength(1);
});

test("RLS: user cannot INSERT a row with a foreign user_id", async () => {
  const res = await clientB.from("food_entries").insert(foodPayload(userA.id)).select();
  expect(res.error).not.toBeNull();
  expect(res.data).toBeNull();
});

test("RLS: isolation holds on meals, daily_metrics, user_goals, meal_items", async () => {
  const mealA = await clientA.from("meals").insert({ user_id: userA.id, name: "A meal" }).select().single();
  expect(mealA.error).toBeNull();
  expect((await clientB.from("meals").select("*").eq("id", mealA.data.id)).data).toEqual([]);
  expect((await clientB.from("meals").insert({ user_id: userA.id, name: "forge" }).select()).error).not.toBeNull();

  const dmA = await clientA.from("daily_metrics").insert({ user_id: userA.id, metric_date: "2026-07-15", weight_kg: 70 }).select().single();
  expect(dmA.error).toBeNull();
  expect((await clientB.from("daily_metrics").select("*").eq("id", dmA.data.id)).data).toEqual([]);
  expect((await clientB.from("daily_metrics").insert({ user_id: userA.id, metric_date: "2026-07-16", weight_kg: 70 }).select()).error).not.toBeNull();

  const ugA = await clientA.from("user_goals").insert({ user_id: userA.id, weight_unit: "kg" }).select().single();
  expect(ugA.error).toBeNull();
  expect((await clientB.from("user_goals").select("*").eq("user_id", userA.id)).data).toEqual([]);
  expect((await clientB.from("user_goals").insert({ user_id: userA.id, weight_unit: "kg" }).select()).error).not.toBeNull();

  const miA = await clientA.from("meal_items").insert({ meal_id: mealA.data.id, user_id: userA.id, name: "Egg", quantity: 3, calories_per_unit: 70, protein_g_per_unit: 6 }).select().single();
  expect(miA.error).toBeNull();
  expect((await clientB.from("meal_items").select("*").eq("id", miA.data.id)).data).toEqual([]);
});

test("RLS: cross-user meal_item forge rejected (composite FK + WITH CHECK)", async () => {
  const mealA = await clientA.from("meals").insert({ user_id: userA.id, name: "A private meal" }).select().single();
  const mealId = mealA.data.id;
  const forge1 = await clientB.from("meal_items").insert({ meal_id: mealId, user_id: userB.id, name: "x", quantity: 1, calories_per_unit: 1, protein_g_per_unit: 1 }).select();
  expect(forge1.error).not.toBeNull();
  const forge2 = await clientB.from("meal_items").insert({ meal_id: mealId, user_id: userA.id, name: "x", quantity: 1, calories_per_unit: 1, protein_g_per_unit: 1 }).select();
  expect(forge2.error).not.toBeNull();
});

test("RLS: daily_food_totals view is per-user", async () => {
  const day = "2026-07-10";
  await clientA.from("food_entries").insert(foodPayload(userA.id, { consumed_at: day + "T12:00:00Z", calories_per_unit: 100, quantity: 1, protein_g_per_unit: 5 })).select();
  await clientB.from("food_entries").insert(foodPayload(userB.id, { consumed_at: day + "T12:00:00Z", calories_per_unit: 999, quantity: 1, protein_g_per_unit: 5 })).select();
  const aView = await clientA.from("daily_food_totals").select("*");
  expect(aView.error).toBeNull();
  for (const r of aView.data as Array<{ total_calories: number }>) {
    expect(r.total_calories).not.toBe(999);
  }
});

test("RLS: unauthenticated anon client reads nothing", async () => {
  const anon = createClient(URL, ANON, { auth: { autoRefreshToken: false, persistSession: false } });
  const res = await anon.from("food_entries").select("*");
  if (res.error) {
    expect(res.error).not.toBeNull();
  } else {
    expect(res.data).toEqual([]);
  }
});

// ---- DB CONSTRAINTS ----

test("constraint: negative calories_per_unit rejected", async () => {
  expect((await clientA.from("food_entries").insert(foodPayload(userA.id, { calories_per_unit: -1 })).select()).error).not.toBeNull();
});

test("constraint: quantity must be greater than 0", async () => {
  expect((await clientA.from("food_entries").insert(foodPayload(userA.id, { quantity: 0 })).select()).error).not.toBeNull();
  expect((await clientA.from("food_entries").insert(foodPayload(userA.id, { quantity: -3 })).select()).error).not.toBeNull();
});

test("constraint: empty/whitespace consumed_tz and null consumed_at rejected", async () => {
  expect((await clientA.from("food_entries").insert(foodPayload(userA.id, { consumed_tz: "" })).select()).error).not.toBeNull();
  expect((await clientA.from("food_entries").insert(foodPayload(userA.id, { consumed_tz: "   " })).select()).error).not.toBeNull();
  expect((await clientA.from("food_entries").insert(foodPayload(userA.id, { consumed_at: null })).select()).error).not.toBeNull();
});

test("constraint: empty/whitespace name rejected", async () => {
  expect((await clientA.from("food_entries").insert(foodPayload(userA.id, { name: "   " })).select()).error).not.toBeNull();
});

test("constraint: future consumed_local_date rejected", async () => {
  expect((await clientA.from("food_entries").insert(foodPayload(userA.id, { consumed_at: "2030-01-01T12:00:00Z" })).select()).error).not.toBeNull();
});

test("constraint: invalid weight_unit rejected; kg and lb accepted", async () => {
  expect((await clientA.from("user_goals").upsert({ user_id: userA.id, weight_unit: "stone" }).select()).error).not.toBeNull();
  expect((await clientA.from("user_goals").upsert({ user_id: userA.id, weight_unit: "lb" }).select()).error).toBeNull();
  expect((await clientA.from("user_goals").upsert({ user_id: userA.id, weight_unit: "kg" }).select()).error).toBeNull();
});

test("constraint: weight_kg greater than 0 and body_fat_pct within 0..100", async () => {
  expect((await clientA.from("daily_metrics").insert({ user_id: userA.id, metric_date: "2026-07-01", weight_kg: 0 }).select()).error).not.toBeNull();
  expect((await clientA.from("daily_metrics").insert({ user_id: userA.id, metric_date: "2026-07-02", weight_kg: 70, body_fat_pct: -1 }).select()).error).not.toBeNull();
  expect((await clientA.from("daily_metrics").insert({ user_id: userA.id, metric_date: "2026-07-03", weight_kg: 70, body_fat_pct: 150 }).select()).error).not.toBeNull();
});

test("constraint: daily_metrics unique(user_id, metric_date)", async () => {
  const day = "2026-06-15";
  expect((await clientA.from("daily_metrics").insert({ user_id: userA.id, metric_date: day, weight_kg: 70 }).select()).error).toBeNull();
  expect((await clientA.from("daily_metrics").insert({ user_id: userA.id, metric_date: day, weight_kg: 71 }).select()).error).not.toBeNull();
});

test("constraint: daily_metrics future boundary loose (current_date+1 ok, +5 rejected)", async () => {
  const plus = (days: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  expect((await clientA.from("daily_metrics").insert({ user_id: userA.id, metric_date: plus(1), weight_kg: 70 }).select()).error).toBeNull();
  expect((await clientA.from("daily_metrics").insert({ user_id: userA.id, metric_date: plus(5), weight_kg: 70 }).select()).error).not.toBeNull();
});

// ---- GENERATED-TOTAL INTEGRITY ----

test("generated: calories/protein_g cannot be set directly", async () => {
  expect((await clientA.from("food_entries").insert(foodPayload(userA.id, { calories: 5 })).select()).error).not.toBeNull();
  expect((await clientA.from("food_entries").insert(foodPayload(userA.id, { protein_g: 5 })).select()).error).not.toBeNull();
});

test("generated: totals equal round(qty x per-unit) and recompute on quantity edit", async () => {
  const ins = await clientA.from("food_entries").insert(foodPayload(userA.id, { quantity: 3, calories_per_unit: 70, protein_g_per_unit: 6.5 })).select().single();
  expect(ins.error).toBeNull();
  expect(ins.data.calories).toBe(210);
  expect(Number(ins.data.protein_g)).toBe(19.5);
  const upd = await clientA.from("food_entries").update({ quantity: 4 }).eq("id", ins.data.id).select().single();
  expect(upd.data.calories).toBe(280);
  expect(Number(upd.data.protein_g)).toBe(26);
});

test("generated: calories uses round (100.5 to 101)", async () => {
  const ins = await clientA.from("food_entries").insert(foodPayload(userA.id, { quantity: 1, calories_per_unit: 100.5, protein_g_per_unit: 0 })).select().single();
  expect(ins.error).toBeNull();
  expect(ins.data.calories).toBe(101);
});

// ---- TRIGGER-DERIVED consumed_local_date ----

test("trigger: consumed_local_date derived near midnight both directions", async () => {
  const ny = await clientA.from("food_entries").insert(foodPayload(userA.id, { consumed_at: "2026-07-15T02:00:00Z", consumed_tz: "America/New_York" })).select("consumed_local_date").single();
  expect(ny.data!.consumed_local_date).toBe("2026-07-14");
  const tk = await clientA.from("food_entries").insert(foodPayload(userA.id, { consumed_at: "2026-07-15T23:00:00Z", consumed_tz: "Asia/Tokyo" })).select("consumed_local_date").single();
  expect(tk.data!.consumed_local_date).toBe("2026-07-16");
});

test("trigger: same instant diverges by captured tz (travelling user)", async () => {
  const instant = "2026-07-15T02:00:00Z";
  const ny = await clientA.from("food_entries").insert(foodPayload(userA.id, { consumed_at: instant, consumed_tz: "America/New_York" })).select("consumed_local_date").single();
  const tk = await clientA.from("food_entries").insert(foodPayload(userA.id, { consumed_at: instant, consumed_tz: "Asia/Tokyo" })).select("consumed_local_date").single();
  expect(ny.data!.consumed_local_date).toBe("2026-07-14");
  expect(tk.data!.consumed_local_date).toBe("2026-07-15");
});

test("trigger: client-supplied consumed_local_date is overwritten", async () => {
  const res = await clientA.from("food_entries").insert(foodPayload(userA.id, { consumed_at: "2026-07-15T12:00:00Z", consumed_tz: "America/New_York", consumed_local_date: "1999-01-01" })).select("consumed_local_date").single();
  expect(res.error).toBeNull();
  expect(res.data!.consumed_local_date).toBe("2026-07-15");
});

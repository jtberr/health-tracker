import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "../../../e2e/helpers/test-users";
import { createUserClient } from "../../../e2e/helpers/user-client";
import { createAdminClient } from "../../../e2e/helpers/admin-client";
import { groupByConsumedAt } from "@/lib/domain/entry-grouping";
import type { FoodEntry } from "@/lib/types";

/**
 * QA-REVIEWER independent action-level suite for Phase 8 copyFoodEntries.
 *
 * Written from docs/architecture/food-weight-tracker.md 3.3 (the shared copy primitive contract),
 * 2 copy/repeat requirements (a)/(b)/(c), 6 "Copy a meal group = exact subset" and 8 Phase 8's own
 * 6-scope list -- NOT from src/lib/actions/food.test.ts (read only afterwards, to look for gaps).
 *
 * Why this level and not only the browser: CopyDayDialog/CopyGroupDialog build their entryIds from
 * React props that were themselves fetched through the RLS-scoped browser client, so a foreign id
 * can never reach the DOM to be tampered with -- unlike Phase 7b's hidden entryIds inputs. The
 * hostile-client surface for copyFoodEntries is therefore a direct Server Action invocation, which
 * is what this file exercises: the real action, against real local Postgres, with
 * @/lib/supabase/server returning a REAL anon-key client already signed in as a real user (so RLS
 * is genuinely in force -- never service-role). Every "was anything written?" assertion is made via
 * the service-role admin client, so "zero rows" means zero rows ANYWHERE, not merely zero rows
 * visible to the caller (the Phase 7/7b evidentiary bar).
 */

let currentClient: SupabaseClient;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentClient,
}));

const hasSupabaseEnv =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

type Seed = {
  name: string;
  quantity?: number;
  unit?: string | null;
  caloriesPerUnit: number;
  proteinGPerUnit: number;
  consumedAt: string;
  consumedTz?: string;
  loggedFromMealId?: string | null;
};

async function seed(client: SupabaseClient, user: TestUser, row: Seed): Promise<FoodEntry> {
  const { data, error } = await client
    .from("food_entries")
    .insert({
      user_id: user.id,
      name: row.name,
      quantity: row.quantity ?? 1,
      unit: row.unit ?? null,
      calories_per_unit: row.caloriesPerUnit,
      protein_g_per_unit: row.proteinGPerUnit,
      consumed_at: row.consumedAt,
      consumed_tz: row.consumedTz ?? "UTC",
      logged_from_meal_id: row.loggedFromMealId ?? null,
    })
    .select()
    .single();
  if (error || !data) throw new Error("seed failed: " + (error ? error.message : "no data"));
  return data as FoodEntry;
}

async function allRows(userId: string): Promise<FoodEntry[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("food_entries")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error("admin read failed: " + error.message);
  return (data ?? []) as FoodEntry[];
}

function utcAt(date: string, time: string): string {
  return date + "T" + time + ":00+00:00";
}

function iso(value: string): string {
  return new Date(value).toISOString();
}

function utcDateOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

describe.skipIf(!hasSupabaseEnv)("QA: copyFoodEntries (Phase 8, real Postgres/RLS)", () => {
  let userA: TestUser;
  let userB: TestUser;
  let clientA: SupabaseClient;
  let clientB: SupabaseClient;
  const sourceDay = utcDateOffset(-5);
  const targetDay = utcDateOffset(-3);

  beforeEach(async () => {
    userA = await createConfirmedTestUser();
    userB = await createConfirmedTestUser();
    clientA = await createUserClient(userA);
    clientB = await createUserClient(userB);
    currentClient = clientA;
  });

  afterEach(async () => {
    await deleteTestUser(userA.id);
    await deleteTestUser(userB.id);
  });

  it("copy-day duplicates EVERY source entry onto the target date, each keeping its own local time-of-day", async () => {
    const { copyFoodEntries } = await import("./food");
    const breakfast = await seed(clientA, userA, {
      name: "Oats", quantity: 1, unit: "bowl", caloriesPerUnit: 320, proteinGPerUnit: 11,
      consumedAt: utcAt(sourceDay, "07:30"),
    });
    const lunch = await seed(clientA, userA, {
      name: "Burrito", quantity: 2, unit: null, caloriesPerUnit: 410.5, proteinGPerUnit: 21.25,
      consumedAt: utcAt(sourceDay, "12:45"),
    });
    const snack = await seed(clientA, userA, {
      name: "Almonds", quantity: 30, unit: "g", caloriesPerUnit: 5.79, proteinGPerUnit: 0.21,
      consumedAt: utcAt(sourceDay, "20:00"),
    });

    const result = await copyFoodEntries({
      entryIds: [breakfast.id, lunch.id, snack.id], toDate: targetDay, toTz: "UTC",
    });

    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(3);

    const copies = (await allRows(userA.id)).filter((r) => r.consumed_local_date === targetDay);
    expect(copies).toHaveLength(3);

    const byName = new Map(copies.map((c) => [c.name, c]));
    expect(iso(byName.get("Oats")!.consumed_at)).toBe(iso(utcAt(targetDay, "07:30")));
    expect(iso(byName.get("Burrito")!.consumed_at)).toBe(iso(utcAt(targetDay, "12:45")));
    expect(iso(byName.get("Almonds")!.consumed_at)).toBe(iso(utcAt(targetDay, "20:00")));
    expect(groupByConsumedAt(copies)).toHaveLength(3);

    for (const source of [breakfast, lunch, snack]) {
      const copy = byName.get(source.name)!;
      expect(copy.id).not.toBe(source.id);
      expect(copy.user_id).toBe(userA.id);
      expect(copy.quantity).toBe(source.quantity);
      expect(copy.unit).toBe(source.unit);
      expect(copy.calories_per_unit).toBe(source.calories_per_unit);
      expect(copy.protein_g_per_unit).toBe(source.protein_g_per_unit);
      expect(copy.calories).toBe(source.calories);
      expect(copy.protein_g).toBe(source.protein_g);
      expect(copy.logged_from_meal_id).toBeNull();
    }
  });

  it("leaves every source row BYTE-IDENTICAL (full-row equality, including updated_at)", async () => {
    const { copyFoodEntries } = await import("./food");
    const a = await seed(clientA, userA, {
      name: "Rice", quantity: 1.5, unit: "cup", caloriesPerUnit: 205, proteinGPerUnit: 4.3,
      consumedAt: utcAt(sourceDay, "18:00"),
    });
    const b = await seed(clientA, userA, {
      name: "Chicken", caloriesPerUnit: 165, proteinGPerUnit: 31, consumedAt: utcAt(sourceDay, "18:00"),
    });

    const before = (await allRows(userA.id)).filter((r) => r.consumed_local_date === sourceDay);
    expect(before).toHaveLength(2);

    const result = await copyFoodEntries({ entryIds: [a.id, b.id], toDate: targetDay, toTz: "UTC" });
    expect(result.ok).toBe(true);

    const after = (await allRows(userA.id)).filter((r) => r.consumed_local_date === sourceDay);
    expect(after).toEqual(before);
  });

  it("copying to the SAME day duplicates the entries rather than overwriting them", async () => {
    const { copyFoodEntries } = await import("./food");
    const entry = await seed(clientA, userA, {
      name: "Coffee", caloriesPerUnit: 5, proteinGPerUnit: 0.3, consumedAt: utcAt(sourceDay, "06:15"),
    });

    const result = await copyFoodEntries({ entryIds: [entry.id], toDate: sourceDay, toTz: "UTC" });
    expect(result.ok).toBe(true);

    const rows = (await allRows(userA.id)).filter((r) => r.name === "Coffee");
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((r) => r.id)).size).toBe(2);
  });

  it("copy-group: entries sharing one exact consumed_at land on ONE new instant and stay a single group", async () => {
    const { copyFoodEntries } = await import("./food");
    const shared = utcAt(sourceDay, "12:30");
    const one = await seed(clientA, userA, { name: "Eggs", quantity: 3, unit: "egg", caloriesPerUnit: 72, proteinGPerUnit: 6.3, consumedAt: shared });
    const two = await seed(clientA, userA, { name: "Toast", quantity: 2, unit: "slice", caloriesPerUnit: 90, proteinGPerUnit: 3.1, consumedAt: shared });
    const three = await seed(clientA, userA, { name: "Juice", caloriesPerUnit: 110, proteinGPerUnit: 1.7, consumedAt: shared });
    await seed(clientA, userA, { name: "Late snack", caloriesPerUnit: 200, proteinGPerUnit: 5, consumedAt: utcAt(sourceDay, "21:00") });

    const result = await copyFoodEntries({
      entryIds: [one.id, two.id, three.id], toDate: targetDay, toTz: "UTC",
    });
    expect(result.ok).toBe(true);

    const copies = (await allRows(userA.id)).filter((r) => r.consumed_local_date === targetDay);
    expect(copies.map((c) => c.name).sort()).toEqual(["Eggs", "Juice", "Toast"]);
    const groups = groupByConsumedAt(copies);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries).toHaveLength(3);
    expect(iso(groups[0].consumedAt)).toBe(iso(utcAt(targetDay, "12:30")));
  });

  it("an explicit toTime overrides every row time-of-day, so Log again lands one entry at the chosen instant", async () => {
    const { copyFoodEntries } = await import("./food");
    const entry = await seed(clientA, userA, {
      name: "Protein shake", quantity: 1, unit: "scoop", caloriesPerUnit: 120, proteinGPerUnit: 24,
      consumedAt: utcAt(sourceDay, "05:45"),
    });

    const result = await copyFoodEntries({
      entryIds: [entry.id], toDate: targetDay, toTime: "14:15", toTz: "UTC",
    });
    expect(result.ok).toBe(true);

    const copies = (await allRows(userA.id)).filter((r) => r.consumed_local_date === targetDay);
    expect(copies).toHaveLength(1);
    expect(iso(copies[0].consumed_at)).toBe(iso(utcAt(targetDay, "14:15")));
    expect(copies[0].consumed_tz).toBe("UTC");
    expect(copies[0].logged_from_meal_id).toBeNull();
  });

  it("rejects an OFF-GRID toTime (a copy cannot route around the 15-minute grid) and writes no rows", async () => {
    const { copyFoodEntries } = await import("./food");
    const entry = await seed(clientA, userA, { name: "Bar", caloriesPerUnit: 200, proteinGPerUnit: 10, consumedAt: utcAt(sourceDay, "10:00") });

    const result = await copyFoodEntries({
      entryIds: [entry.id], toDate: targetDay, toTime: "14:07", toTz: "UTC",
    });

    expect(result.ok).toBe(false);
    expect(await allRows(userA.id)).toHaveLength(1);
  });

  it("drops logged_from_meal_id even when the SOURCE entry carries one", async () => {
    const { copyFoodEntries } = await import("./food");
    const { data: meal } = await clientA.from("meals").insert({ user_id: userA.id, name: "Breakfast staple" }).select().single();
    const mealId = (meal as { id: string }).id;

    const shared = utcAt(sourceDay, "08:00");
    const one = await seed(clientA, userA, { name: "Egg", quantity: 2, unit: "egg", caloriesPerUnit: 72, proteinGPerUnit: 6.3, consumedAt: shared, loggedFromMealId: mealId });
    const two = await seed(clientA, userA, { name: "Toast", quantity: 1, unit: "slice", caloriesPerUnit: 90, proteinGPerUnit: 3.1, consumedAt: shared, loggedFromMealId: mealId });

    expect(one.logged_from_meal_id).toBe(mealId);
    expect(two.logged_from_meal_id).toBe(mealId);

    const result = await copyFoodEntries({ entryIds: [one.id, two.id], toDate: targetDay, toTz: "UTC" });
    expect(result.ok).toBe(true);

    const copies = (await allRows(userA.id)).filter((r) => r.consumed_local_date === targetDay);
    expect(copies).toHaveLength(2);
    for (const copy of copies) expect(copy.logged_from_meal_id).toBeNull();

    const sources = (await allRows(userA.id)).filter((r) => r.consumed_local_date === sourceDay);
    for (const src of sources) expect(src.logged_from_meal_id).toBe(mealId);
  });

  it("rejects a future toDate with error future_date and writes ZERO rows", async () => {
    const { copyFoodEntries } = await import("./food");
    const entry = await seed(clientA, userA, { name: "Soup", caloriesPerUnit: 150, proteinGPerUnit: 6, consumedAt: utcAt(sourceDay, "13:00") });

    const result = await copyFoodEntries({ entryIds: [entry.id], toDate: utcDateOffset(1), toTz: "UTC" });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("future_date");
    expect(await allRows(userA.id)).toHaveLength(1);
  });

  it("a legitimate today in a far-ahead timezone (UTC+14) is NOT falsely rejected", async () => {
    const { copyFoodEntries } = await import("./food");
    const entry = await seed(clientA, userA, { name: "Noodles", caloriesPerUnit: 380, proteinGPerUnit: 12, consumedAt: utcAt(sourceDay, "11:00") });

    const todayThere = new Intl.DateTimeFormat("en-CA", { timeZone: "Pacific/Kiritimati" }).format(new Date());
    const result = await copyFoodEntries({
      entryIds: [entry.id], toDate: todayThere, toTime: "09:00", toTz: "Pacific/Kiritimati",
    });

    expect(result.ok).toBe(true);
    const copies = (await allRows(userA.id)).filter((r) => r.id !== entry.id);
    expect(copies).toHaveLength(1);
    expect(copies[0].consumed_local_date).toBe(todayThere);
  });

  it("a shape-valid but calendar-overflowing toDate cannot smuggle a FUTURE-dated row past the cap", async () => {
    const { copyFoodEntries } = await import("./food");
    const entry = await seed(clientA, userA, { name: "Overflow probe", caloriesPerUnit: 100, proteinGPerUnit: 1, consumedAt: utcAt(sourceDay, "09:00") });

    const lastMonth = new Date();
    lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
    const overflowDate = lastMonth.getUTCFullYear() + "-" + String(lastMonth.getUTCMonth() + 1).padStart(2, "0") + "-99";

    const result = await copyFoodEntries({ entryIds: [entry.id], toDate: overflowDate, toTz: "UTC" });

    const written = (await allRows(userA.id)).filter((r) => r.id !== entry.id);
    const todayUtc = utcDateOffset(0);
    for (const r of written) expect(r.consumed_local_date <= todayUtc).toBe(true);
    if (!result.ok) expect(written).toHaveLength(0);
  });

  it("rejects ANOTHER USER entry id wholesale, writing zero rows for either user", async () => {
    const { copyFoodEntries } = await import("./food");
    const foreign = await seed(clientB, userB, { name: "B dinner", caloriesPerUnit: 600, proteinGPerUnit: 40, consumedAt: utcAt(sourceDay, "19:00") });

    currentClient = clientA;
    const result = await copyFoodEntries({ entryIds: [foreign.id], toDate: targetDay, toTz: "UTC" });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("entries_not_found");
    expect(await allRows(userA.id)).toHaveLength(0);
    expect(await allRows(userB.id)).toHaveLength(1);
  });

  it("rejects a MIXED own+foreign id set wholesale -- never a silent partial copy", async () => {
    const { copyFoodEntries } = await import("./food");
    const mine = await seed(clientA, userA, { name: "A lunch", caloriesPerUnit: 500, proteinGPerUnit: 25, consumedAt: utcAt(sourceDay, "12:00") });
    const theirs = await seed(clientB, userB, { name: "B lunch", caloriesPerUnit: 700, proteinGPerUnit: 30, consumedAt: utcAt(sourceDay, "12:00") });

    currentClient = clientA;
    const result = await copyFoodEntries({ entryIds: [mine.id, theirs.id], toDate: targetDay, toTz: "UTC" });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("entries_not_found");
    const rowsA = await allRows(userA.id);
    expect(rowsA).toHaveLength(1);
    expect(rowsA[0].id).toBe(mine.id);
    expect(await allRows(userB.id)).toHaveLength(1);
  });

  it("rejects a nonexistent (well-formed, never-existed) uuid and writes no rows", async () => {
    const { copyFoodEntries } = await import("./food");
    const mine = await seed(clientA, userA, { name: "Real", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: utcAt(sourceDay, "10:00") });

    const result = await copyFoodEntries({
      entryIds: [mine.id, "00000000-0000-4000-8000-000000000000"], toDate: targetDay, toTz: "UTC",
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("entries_not_found");
    expect(await allRows(userA.id)).toHaveLength(1);
  });

  it("a foreign id and a nonexistent id are indistinguishable (no cross-user enumeration oracle)", async () => {
    const { copyFoodEntries } = await import("./food");
    const foreign = await seed(clientB, userB, { name: "B only", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: utcAt(sourceDay, "10:00") });

    currentClient = clientA;
    const foreignResult = await copyFoodEntries({ entryIds: [foreign.id], toDate: targetDay, toTz: "UTC" });
    const missingResult = await copyFoodEntries({
      entryIds: ["00000000-0000-4000-8000-000000000001"], toDate: targetDay, toTz: "UTC",
    });

    expect(foreignResult.error).toBe(missingResult.error);
  });

  it("a duplicated id is deduped and cannot be used to pad the count past a foreign id", async () => {
    const { copyFoodEntries } = await import("./food");
    const mine = await seed(clientA, userA, { name: "Dup probe", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: utcAt(sourceDay, "10:00") });
    const theirs = await seed(clientB, userB, { name: "Not mine", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: utcAt(sourceDay, "10:00") });

    currentClient = clientA;
    const padded = await copyFoodEntries({ entryIds: [mine.id, mine.id, theirs.id], toDate: targetDay, toTz: "UTC" });
    expect(padded.ok).toBe(false);
    expect(await allRows(userA.id)).toHaveLength(1);

    const deduped = await copyFoodEntries({ entryIds: [mine.id, mine.id], toDate: targetDay, toTz: "UTC" });
    expect(deduped.ok).toBe(true);
    expect(deduped.entries).toHaveLength(1);
    expect((await allRows(userA.id)).filter((r) => r.consumed_local_date === targetDay)).toHaveLength(1);
  });

  it("rejects an empty selection with no_entries and writes no rows", async () => {
    const { copyFoodEntries } = await import("./food");
    await seed(clientA, userA, { name: "Untouched", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: utcAt(sourceDay, "10:00") });

    expect((await copyFoodEntries({ entryIds: [], toDate: targetDay, toTz: "UTC" })).error).toBe("no_entries");
    expect((await copyFoodEntries({ entryIds: ["", ""], toDate: targetDay, toTz: "UTC" })).error).toBe("no_entries");
    expect(await allRows(userA.id)).toHaveLength(1);
  });

  it("a malformed (non-uuid) entry id fails gracefully without throwing, and writes no rows", async () => {
    const { copyFoodEntries } = await import("./food");
    await seed(clientA, userA, { name: "Untouched", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: utcAt(sourceDay, "10:00") });

    const result = await copyFoodEntries({ entryIds: ["not-a-uuid"], toDate: targetDay, toTz: "UTC" });

    expect(result.ok).toBe(false);
    expect(await allRows(userA.id)).toHaveLength(1);
  });

  it("a garbled toTz fails gracefully with invalid_timezone and writes no rows", async () => {
    const { copyFoodEntries } = await import("./food");
    const mine = await seed(clientA, userA, { name: "Tz probe", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: utcAt(sourceDay, "10:00") });

    const result = await copyFoodEntries({ entryIds: [mine.id], toDate: targetDay, toTz: "Not/AZone" });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("invalid_timezone");
    expect(await allRows(userA.id)).toHaveLength(1);
  });

  it("an unauthenticated caller is rejected before any read or write", async () => {
    const { copyFoodEntries } = await import("./food");
    const { createClient: rawCreateClient } = await import("@supabase/supabase-js");
    const mine = await seed(clientA, userA, { name: "Auth probe", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: utcAt(sourceDay, "10:00") });

    currentClient = rawCreateClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL as string,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const result = await copyFoodEntries({ entryIds: [mine.id], toDate: targetDay, toTz: "UTC" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("unauthenticated");

    currentClient = clientA;
    expect(await allRows(userA.id)).toHaveLength(1);
  });

  it("EDGE: a group sharing one consumed_at but logged in DIFFERENT time zones", async () => {
    const { copyFoodEntries } = await import("./food");
    const shared = utcAt(sourceDay, "12:00");
    const tokyo = await seed(clientA, userA, { name: "Tokyo item", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: shared, consumedTz: "Asia/Tokyo" });
    const ny = await seed(clientA, userA, { name: "NY item", caloriesPerUnit: 100, proteinGPerUnit: 5, consumedAt: shared, consumedTz: "America/New_York" });

    expect(groupByConsumedAt([tokyo, ny])).toHaveLength(1);

    const result = await copyFoodEntries({ entryIds: [tokyo.id, ny.id], toDate: targetDay, toTz: "UTC" });
    expect(result.ok).toBe(true);

    const copies = (await allRows(userA.id)).filter((r) => r.consumed_local_date === targetDay);
    expect(copies).toHaveLength(2);
    // Documented outcome (see the QA report N-notes): each copy preserves ITS OWN source-tz local
    // time-of-day, so a mixed-tz group splits into two groups on the target day.
    expect(groupByConsumedAt(copies)).toHaveLength(2);
  });
});

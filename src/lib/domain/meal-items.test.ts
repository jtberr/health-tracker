import { describe, expect, it } from "vitest";
import { computeReorderedSortOrders, groupMealItemsByMeal, mealItemsFromEntries } from "./meal-items";
import type { FoodEntry, MealItem } from "@/lib/types";

function makeItem(overrides: Partial<MealItem>): MealItem {
  return {
    id: "item-1",
    meal_id: "meal-1",
    user_id: "user-1",
    name: "Eggs",
    quantity: 1,
    unit: null,
    calories_per_unit: 70,
    protein_g_per_unit: 6,
    calories: 70,
    protein_g: 6,
    sort_order: 0,
    created_at: "2026-07-19T00:00:00Z",
    updated_at: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}

describe("groupMealItemsByMeal", () => {
  it("groups items by meal_id", () => {
    const items = [
      makeItem({ id: "a", meal_id: "meal-1" }),
      makeItem({ id: "b", meal_id: "meal-2" }),
      makeItem({ id: "c", meal_id: "meal-1" }),
    ];
    const grouped = groupMealItemsByMeal(items);
    expect(Object.keys(grouped).sort()).toEqual(["meal-1", "meal-2"]);
    expect(grouped["meal-1"].map((i) => i.id)).toEqual(["a", "c"]);
    expect(grouped["meal-2"].map((i) => i.id)).toEqual(["b"]);
  });

  it("preserves the input order within each group", () => {
    const items = [
      makeItem({ id: "z", meal_id: "meal-1", sort_order: 2 }),
      makeItem({ id: "a", meal_id: "meal-1", sort_order: 0 }),
      makeItem({ id: "m", meal_id: "meal-1", sort_order: 1 }),
    ];
    const grouped = groupMealItemsByMeal(items);
    // Pure function trusts the caller's ordering — it doesn't re-sort by sort_order itself.
    expect(grouped["meal-1"].map((i) => i.id)).toEqual(["z", "a", "m"]);
  });

  it("returns an empty object for an empty input", () => {
    expect(groupMealItemsByMeal([])).toEqual({});
  });

  it("a meal with no items has no key in the result", () => {
    const grouped = groupMealItemsByMeal([makeItem({ id: "a", meal_id: "meal-1" })]);
    expect(grouped["meal-2"]).toBeUndefined();
    // Callers default a missing key to an empty array, e.g. `grouped[id] ?? []`.
    expect(grouped["meal-2"] ?? []).toEqual([]);
  });
});

describe("computeReorderedSortOrders", () => {
  it("assigns sort_order from each id's index in the array", () => {
    expect(computeReorderedSortOrders(["c", "a", "b"])).toEqual([
      { id: "c", sortOrder: 0 },
      { id: "a", sortOrder: 1 },
      { id: "b", sortOrder: 2 },
    ]);
  });

  it("handles a single item", () => {
    expect(computeReorderedSortOrders(["only"])).toEqual([{ id: "only", sortOrder: 0 }]);
  });

  it("handles an empty list", () => {
    expect(computeReorderedSortOrders([])).toEqual([]);
  });

  it("reflects a swap of two adjacent items", () => {
    // Simulates moving index 1 up by one (swap with index 0).
    const original = ["a", "b", "c"];
    const swapped = [original[1], original[0], original[2]];
    expect(computeReorderedSortOrders(swapped)).toEqual([
      { id: "b", sortOrder: 0 },
      { id: "a", sortOrder: 1 },
      { id: "c", sortOrder: 2 },
    ]);
  });
});

function makeEntry(overrides: Partial<FoodEntry>): FoodEntry {
  return {
    id: "entry-1",
    user_id: "user-1",
    name: "Eggs",
    quantity: 1,
    unit: null,
    calories_per_unit: 70,
    protein_g_per_unit: 6,
    calories: 70,
    protein_g: 6,
    consumed_at: "2026-07-30T12:00:00Z",
    consumed_tz: "America/Chicago",
    consumed_local_date: "2026-07-30",
    logged_from_meal_id: null,
    created_at: "2026-07-30T12:00:00Z",
    updated_at: "2026-07-30T12:00:00Z",
    ...overrides,
  };
}

describe("mealItemsFromEntries", () => {
  it("copies exactly name/quantity/unit/per-unit calories and protein, and nothing else", () => {
    const entries = [
      makeEntry({
        id: "a",
        name: "Toast",
        quantity: 2,
        unit: "slice",
        calories_per_unit: 80,
        protein_g_per_unit: 3,
        calories: 160,
        protein_g: 6,
        created_at: "2026-07-30T12:00:00Z",
      }),
    ];
    const drafts = mealItemsFromEntries(entries);

    expect(drafts).toEqual([
      {
        name: "Toast",
        quantity: 2,
        unit: "slice",
        caloriesPerUnit: 80,
        proteinGPerUnit: 3,
        sortOrder: 0,
      },
    ]);
    // Explicitly confirm nothing else leaks through: no id/user_id/consumed_*/logged_from_meal_id,
    // and no generated calories/protein_g total (the DB recomputes those from quantity x per-unit).
    const draft = drafts[0] as Record<string, unknown>;
    expect(draft.id).toBeUndefined();
    expect(draft.user_id).toBeUndefined();
    expect(draft.consumed_at).toBeUndefined();
    expect(draft.consumed_tz).toBeUndefined();
    expect(draft.consumed_local_date).toBeUndefined();
    expect(draft.logged_from_meal_id).toBeUndefined();
    expect(draft.calories).toBeUndefined();
    expect(draft.protein_g).toBeUndefined();
  });

  it("orders drafts by created_at then id, regardless of input order (a group shares one consumed_at)", () => {
    // All three share the identical consumed_at, as a real exact-timestamp group would --
    // consumed_at therefore cannot break the tie; created_at must.
    const shared = "2026-07-30T12:00:00Z";
    const first = makeEntry({ id: "b", name: "First", consumed_at: shared, created_at: "2026-07-30T11:59:58Z" });
    const second = makeEntry({ id: "a", name: "Second", consumed_at: shared, created_at: "2026-07-30T11:59:59Z" });
    const third = makeEntry({ id: "c", name: "Third", consumed_at: shared, created_at: "2026-07-30T12:00:00Z" });

    // Feed in shuffled order -- the function must not trust it.
    const drafts = mealItemsFromEntries([third, first, second]);

    expect(drafts.map((d) => d.name)).toEqual(["First", "Second", "Third"]);
    expect(drafts.map((d) => d.sortOrder)).toEqual([0, 1, 2]);
  });

  it("breaks an identical created_at tie by id", () => {
    const sameInstant = "2026-07-30T12:00:00Z";
    const entries = [
      makeEntry({ id: "zeta", name: "Zeta", created_at: sameInstant }),
      makeEntry({ id: "alpha", name: "Alpha", created_at: sameInstant }),
    ];
    const drafts = mealItemsFromEntries(entries);
    expect(drafts.map((d) => d.name)).toEqual(["Alpha", "Zeta"]);
  });

  it("a single entry produces one draft with sortOrder 0", () => {
    const drafts = mealItemsFromEntries([makeEntry({ id: "only", name: "Solo" })]);
    expect(drafts).toEqual([
      {
        name: "Solo",
        quantity: 1,
        unit: null,
        caloriesPerUnit: 70,
        proteinGPerUnit: 6,
        sortOrder: 0,
      },
    ]);
  });

  it("an empty list produces an empty list", () => {
    expect(mealItemsFromEntries([])).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { computeReorderedSortOrders, groupMealItemsByMeal } from "./meal-items";
import type { MealItem } from "@/lib/types";

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

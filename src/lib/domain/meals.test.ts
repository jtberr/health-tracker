import { describe, expect, it } from "vitest";
import { filterMealsByName, sortMealsByName } from "./meals";
import type { Meal } from "@/lib/types";

function makeMeal(overrides: Partial<Meal>): Meal {
  return {
    id: "meal-1",
    user_id: "user-1",
    name: "Meal",
    created_at: "2026-07-19T00:00:00Z",
    updated_at: "2026-07-19T00:00:00Z",
    ...overrides,
  };
}

describe("sortMealsByName", () => {
  it("orders case-insensitively (lowercase does not sort after uppercase)", () => {
    const meals = [
      makeMeal({ id: "b", name: "Banana smoothie" }),
      makeMeal({ id: "a", name: "apple oatmeal" }),
    ];
    // A raw codepoint sort would put "Banana" (B=66) before "apple" (a=97) -- must not.
    expect(sortMealsByName(meals).map((m) => m.name)).toEqual(["apple oatmeal", "Banana smoothie"]);
  });

  it("breaks a tie on identical names by created_at then id, deterministically", () => {
    const meals = [
      makeMeal({ id: "z", name: "Lunch", created_at: "2026-07-20T00:00:00Z" }),
      makeMeal({ id: "a", name: "Lunch", created_at: "2026-07-19T00:00:00Z" }),
    ];
    const result = sortMealsByName(meals);
    expect(result.map((m) => m.id)).toEqual(["a", "z"]);
    // Repeatable -- running it again (including on an already-sorted array) gives the same order.
    expect(sortMealsByName(result).map((m) => m.id)).toEqual(["a", "z"]);
  });

  it("breaks a tie on identical name AND identical created_at by id", () => {
    const sameInstant = "2026-07-19T00:00:00Z";
    const meals = [
      makeMeal({ id: "zeta", name: "Lunch", created_at: sameInstant }),
      makeMeal({ id: "alpha", name: "Lunch", created_at: sameInstant }),
    ];
    expect(sortMealsByName(meals).map((m) => m.id)).toEqual(["alpha", "zeta"]);
  });

  it("returns a new array and does not mutate the input", () => {
    const meals = [makeMeal({ id: "b", name: "Zebra" }), makeMeal({ id: "a", name: "Apple" })];
    const original = [...meals];
    const sorted = sortMealsByName(meals);
    expect(meals).toEqual(original); // input untouched
    expect(sorted).not.toBe(meals); // genuinely a new array
  });

  it("handles an empty list", () => {
    expect(sortMealsByName([])).toEqual([]);
  });
});

describe("filterMealsByName", () => {
  const meals = [
    makeMeal({ id: "1", name: "Chicken and rice" }),
    makeMeal({ id: "2", name: "Beef stir fry" }),
    makeMeal({ id: "3", name: "Rice pudding" }),
  ];

  it("an empty query returns every meal, unchanged, in the given order (identity, not no-results)", () => {
    expect(filterMealsByName(meals, "")).toEqual(meals);
  });

  it("a whitespace-only query also returns every meal unchanged", () => {
    expect(filterMealsByName(meals, "   ")).toEqual(meals);
  });

  it("matches case-insensitively", () => {
    expect(filterMealsByName(meals, "CHICKEN").map((m) => m.id)).toEqual(["1"]);
  });

  it("is a substring match, not a prefix match", () => {
    // "rice" is not a prefix of "Chicken and rice", only a substring.
    expect(filterMealsByName(meals, "rice").map((m) => m.id).sort()).toEqual(["1", "3"]);
  });

  it("ANDs multiple whitespace-separated tokens", () => {
    expect(filterMealsByName(meals, "chick rice").map((m) => m.id)).toEqual(["1"]);
    expect(filterMealsByName(meals, "chick beef")).toEqual([]);
  });

  it("tolerates surrounding and repeated whitespace between tokens", () => {
    expect(filterMealsByName(meals, "  chick   rice  ").map((m) => m.id)).toEqual(["1"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterMealsByName(meals, "pizza")).toEqual([]);
  });

  it("does not search item/ingredient names -- only meal.name", () => {
    // None of the fixture meal *names* contain "cheese" even though a real item inside one might.
    expect(filterMealsByName(meals, "cheese")).toEqual([]);
  });
});

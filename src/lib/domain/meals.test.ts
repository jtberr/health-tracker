import { describe, expect, it } from "vitest";
import { duplicateMealName, filterMealsByName, sortMealsByName } from "./meals";
import type { Meal } from "@/lib/types";

function makeMeal(overrides: Partial<Meal>): Meal {
  return {
    id: "meal-1",
    user_id: "user-1",
    name: "Meal",
    is_pinned: false,
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

  it("puts EVERY pinned meal ahead of EVERY unpinned one, regardless of name", () => {
    const meals = [
      makeMeal({ id: "1", name: "Apple", is_pinned: false }),
      makeMeal({ id: "2", name: "Zebra", is_pinned: true }),
      makeMeal({ id: "3", name: "Mango", is_pinned: false }),
    ];
    // A pinned "Zebra" precedes an unpinned "Apple" -- the whole point of pinning.
    expect(sortMealsByName(meals).map((m) => m.name)).toEqual(["Zebra", "Apple", "Mango"]);
  });

  it("sorts alphabetically WITHIN each partition, and still breaks ties on created_at then id inside a block", () => {
    const meals = [
      makeMeal({ id: "p2", name: "Zebra pinned", is_pinned: true, created_at: "2026-07-20T00:00:00Z" }),
      makeMeal({ id: "p1", name: "Apple pinned", is_pinned: true, created_at: "2026-07-19T00:00:00Z" }),
      makeMeal({ id: "u2", name: "Zebra unpinned", is_pinned: false }),
      makeMeal({ id: "u1", name: "Apple unpinned", is_pinned: false }),
    ];
    expect(sortMealsByName(meals).map((m) => m.id)).toEqual(["p1", "p2", "u1", "u2"]);
  });

  it("pinning one meal does NOT reorder the others -- the unpinned block's relative order is byte-identical before and after", () => {
    const before = [
      makeMeal({ id: "a", name: "Apple" }),
      makeMeal({ id: "b", name: "Banana" }),
      makeMeal({ id: "c", name: "Cherry" }),
    ];
    const beforeOrder = sortMealsByName(before).map((m) => m.id);
    expect(beforeOrder).toEqual(["a", "b", "c"]);

    // Now pin "Banana" -- it moves to the pinned block; "Apple" and "Cherry" must keep their
    // exact same relative order to each other.
    const after = before.map((m) => (m.id === "b" ? { ...m, is_pinned: true } : m));
    const afterOrder = sortMealsByName(after).map((m) => m.id);
    expect(afterOrder).toEqual(["b", "a", "c"]);
    expect(afterOrder.filter((id) => id !== "b")).toEqual(beforeOrder.filter((id) => id !== "b"));
  });

  it("all-pinned degrades to plain alphabetical order", () => {
    const meals = [
      makeMeal({ id: "b", name: "Banana", is_pinned: true }),
      makeMeal({ id: "a", name: "apple", is_pinned: true }),
    ];
    expect(sortMealsByName(meals).map((m) => m.name)).toEqual(["apple", "Banana"]);
  });

  it("all-unpinned (the default case) degrades to plain alphabetical order", () => {
    const meals = [
      makeMeal({ id: "b", name: "Banana", is_pinned: false }),
      makeMeal({ id: "a", name: "apple", is_pinned: false }),
    ];
    expect(sortMealsByName(meals).map((m) => m.name)).toEqual(["apple", "Banana"]);
  });
});

describe("duplicateMealName", () => {
  it('appends " (copy)" to the source name', () => {
    expect(duplicateMealName("Weekday breakfast")).toBe("Weekday breakfast (copy)");
  });

  it("applying it twice yields '... (copy) (copy)' -- the accepted behaviour, not an oversight", () => {
    const once = duplicateMealName("Lunch");
    expect(duplicateMealName(once)).toBe("Lunch (copy) (copy)");
  });

  it("preserves whitespace in the name rather than trimming it away silently", () => {
    expect(duplicateMealName("  Lunch  ")).toBe("  Lunch   (copy)");
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

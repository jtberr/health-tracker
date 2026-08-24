import { describe, it, expect } from "vitest";
import { sortMealsByName, duplicateMealName } from "./meals";
import type { Meal } from "@/lib/types";

/**
 * QA-REVIEWER independent Phase 8f unit suite -- "Saved meals: pinning and duplicating", the pure
 * half. Written from docs/architecture/food-weight-tracker.md 3.3 (`sortMealsByName`'s amended doc
 * comment and `duplicateMealName`'s signature), 3.4's "Pinned meals and duplicating a meal" block
 * and 6's unit bullet -- NOT from the developer's own meals.test.ts.
 *
 * The property to hammer (3.3, verbatim): pinning "changes which block a meal is in and nothing
 * else -- the pinned block is alphabetical too, so pinning meal B never moves meal A".
 */

let seq = 0;
function meal(name: string, isPinned = false, createdAt?: string, id?: string): Meal {
  seq += 1;
  return {
    id: id ?? "id-" + String(seq).padStart(3, "0"),
    user_id: "u1",
    name,
    is_pinned: isPinned,
    created_at: createdAt ?? "2026-01-01T00:00:0" + (seq % 10) + ".000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
  } as Meal;
}

describe("Phase 8f -- sortMealsByName partitions pinned-first", () => {
  it("puts pinned meals ahead of unpinned ones regardless of name", () => {
    const meals = [meal("Apple"), meal("Zebra", true), meal("Banana")];
    expect(sortMealsByName(meals).map((m) => m.name)).toEqual(["Zebra", "Apple", "Banana"]);
  });

  it("keeps each block internally alphabetical, case-insensitively", () => {
    const meals = [
      meal("zebra pinned", true),
      meal("Apple pinned", true),
      meal("banana"),
      meal("Avocado"),
    ];
    expect(sortMealsByName(meals).map((m) => m.name)).toEqual([
      "Apple pinned",
      "zebra pinned",
      "Avocado",
      "banana",
    ]);
  });

  it("THE PROPERTY TO HAMMER: pinning one meal never reorders the others", () => {
    const base = [meal("Alpha"), meal("Bravo"), meal("Charlie"), meal("Delta")];
    const before = sortMealsByName(base).map((m) => m.name);

    // Pin the one that sorts LAST -- the most disruptive possible choice.
    const after = sortMealsByName(
      base.map((m) => (m.name === "Delta" ? { ...m, is_pinned: true } : m)),
    ).map((m) => m.name);

    expect(after[0]).toBe("Delta");
    // Every other meal's RELATIVE order is untouched.
    expect(after.slice(1)).toEqual(before.filter((n) => n !== "Delta"));
  });

  it("degrades to plain alphabetical when all pinned or none pinned", () => {
    const names = ["Charlie", "alpha", "Bravo"];
    const none = sortMealsByName(names.map((n) => meal(n)));
    const all = sortMealsByName(names.map((n) => meal(n, true)));
    expect(none.map((m) => m.name)).toEqual(["alpha", "Bravo", "Charlie"]);
    expect(all.map((m) => m.name)).toEqual(["alpha", "Bravo", "Charlie"]);
  });

  it("still breaks ties by created_at then id INSIDE a block (duplicate names are legitimate)", () => {
    const meals = [
      meal("Snack", true, "2026-03-01T00:00:00.000Z", "id-c"),
      meal("Snack", true, "2026-01-01T00:00:00.000Z", "id-b"),
      meal("Snack", true, "2026-01-01T00:00:00.000Z", "id-a"),
    ];
    expect(sortMealsByName(meals).map((m) => m.id)).toEqual(["id-a", "id-b", "id-c"]);
  });

  it("is deterministic across every rotation of the input, and does not mutate it", () => {
    const meals = [meal("Delta", true), meal("Alpha"), meal("Charlie", true), meal("Bravo")];
    const expected = sortMealsByName(meals).map((m) => m.id);
    for (let i = 0; i < meals.length; i++) {
      const rotated = [...meals.slice(i), ...meals.slice(0, i)];
      expect(sortMealsByName(rotated).map((m) => m.id)).toEqual(expected);
    }
    const snapshot = meals.map((m) => m.id);
    const result = sortMealsByName(meals);
    expect(meals.map((m) => m.id)).toEqual(snapshot); // input untouched
    expect(result).not.toBe(meals); // a NEW array
  });

  it("handles an empty list", () => {
    expect(sortMealsByName([])).toEqual([]);
  });
});

describe("Phase 8f -- duplicateMealName", () => {
  it('appends " (copy)"', () => {
    expect(duplicateMealName("Weekday breakfast")).toBe("Weekday breakfast (copy)");
  });

  it("does NOT hunt for a unique name -- duplicating a duplicate stacks visibly", () => {
    // 3.3: meals.name has no uniqueness constraint and duplicate names are explicitly legitimate,
    // so inventing "(copy 2)" would imply a rule the data model does not have.
    expect(duplicateMealName(duplicateMealName("Snack"))).toBe("Snack (copy) (copy)");
  });

  it("preserves the source name verbatim, including surrounding whitespace and casing", () => {
    expect(duplicateMealName("  Spaced  ")).toBe("  Spaced   (copy)");
    expect(duplicateMealName("ALL CAPS")).toBe("ALL CAPS (copy)");
    expect(duplicateMealName("")).toBe(" (copy)");
  });
});

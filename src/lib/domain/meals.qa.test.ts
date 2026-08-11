import { describe, expect, it } from "vitest";
import { sortMealsByName, filterMealsByName } from "./meals";
import type { Meal } from "@/lib/types";

/**
 * QA-REVIEWER independent unit suite for lib/domain/meals.ts (Phase 7c).
 *
 * Written from docs/architecture/food-weight-tracker.md 3.3 (the two helper signatures and their
 * documented semantics), 6's "meals.ts (Phase 7c)" unit-test row, 5's tripwires, and
 * ai-context/DECISIONS.md's "Saved-meals list scaling is a findability problem..." entry --
 * NOT from the developer's own src/lib/domain/meals.test.ts (read only afterwards, to check for
 * gaps rather than to mirror).
 *
 * The spec sentences these assertions encode, verbatim from 3.3/6:
 *   sortMealsByName -- "case-insensitive alphabetical", ties break on "created_at then id",
 *     "returns a new array; does not mutate", "an unstable sort would make rows jump between
 *     renders" (so: deterministic regardless of input order).
 *   filterMealsByName -- "case-insensitive AND-of-whitespace-separated-tokens SUBSTRING match on
 *     meal.name only", "empty/whitespace-only query returns the input unchanged (identity, not
 *     no results)".
 */

function meal(overrides: Partial<Meal> & { name: string }): Meal {
  return {
    id: overrides.id ?? "id-" + overrides.name.toLowerCase().replace(/\s+/g, "-"),
    user_id: "user-1",
    // Phase 8f adds `is_pinned` to the Meal type; defaulted here (mechanically, not a semantic
    // change to this qa-reviewer-owned file) so every pre-existing fixture in this file keeps
    // typechecking and keeps its original all-unpinned behavior unchanged.
    is_pinned: overrides.is_pinned ?? false,
    created_at: overrides.created_at ?? "2026-01-01T00:00:00.000Z",
    updated_at: overrides.updated_at ?? "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const names = (meals: Meal[]) => meals.map((m) => m.name);
const ids = (meals: Meal[]) => meals.map((m) => m.id);

describe("sortMealsByName (Phase 7c)", () => {
  it("is case-INSENSITIVE, not a raw codepoint sort (the apple-before-Banana case)", () => {
    // A raw codepoint sort puts every uppercase letter before every lowercase one, so "Banana"
    // (0x42) would precede "apple" (0x61). That is the specific bug this row exists to catch.
    const sorted = sortMealsByName([meal({ name: "apple" }), meal({ name: "Banana" })]);
    expect(names(sorted)).toEqual(["apple", "Banana"]);
  });

  it("orders a realistically mixed-case library alphabetically ignoring case", () => {
    const sorted = sortMealsByName([
      meal({ name: "zucchini bake" }),
      meal({ name: "Almond porridge" }),
      meal({ name: "chicken and rice" }),
      meal({ name: "Beef stew" }),
    ]);
    expect(names(sorted)).toEqual([
      "Almond porridge",
      "Beef stew",
      "chicken and rice",
      "zucchini bake",
    ]);
  });

  it("breaks exact-duplicate-name ties on created_at (oldest first)", () => {
    const older = meal({ id: "b", name: "Omelette", created_at: "2026-01-01T00:00:00.000Z" });
    const newer = meal({ id: "a", name: "Omelette", created_at: "2026-06-01T00:00:00.000Z" });
    // Fed newest-first so a naive stable-sort-only pass would leave it newest-first.
    expect(ids(sortMealsByName([newer, older]))).toEqual(["b", "a"]);
    expect(ids(sortMealsByName([older, newer]))).toEqual(["b", "a"]);
  });

  it("treats names differing ONLY in case as tied, falling through to the created_at tie-break", () => {
    // Per the review brief: case differing counts as identical for sort purposes. If case were
    // NOT collapsed for the tie test, these two would order by case instead of by created_at, and
    // the order would flip depending on which spelling was fed first.
    const lower = meal({ id: "lo", name: "omelette", created_at: "2026-03-01T00:00:00.000Z" });
    const upper = meal({ id: "up", name: "OMELETTE", created_at: "2026-01-01T00:00:00.000Z" });
    expect(ids(sortMealsByName([lower, upper]))).toEqual(["up", "lo"]);
    expect(ids(sortMealsByName([upper, lower]))).toEqual(["up", "lo"]);
  });

  it("breaks a created_at tie on id, so same-instant duplicates are still deterministic", () => {
    const sameInstant = "2026-02-02T12:00:00.000Z";
    const a = meal({ id: "aaa", name: "Snack", created_at: sameInstant });
    const b = meal({ id: "bbb", name: "Snack", created_at: sameInstant });
    const c = meal({ id: "ccc", name: "Snack", created_at: sameInstant });
    expect(ids(sortMealsByName([c, a, b]))).toEqual(["aaa", "bbb", "ccc"]);
    expect(ids(sortMealsByName([b, c, a]))).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("is deterministic across ANY input permutation (rows must not jump between renders)", () => {
    const base = [
      meal({ id: "1", name: "Salad", created_at: "2026-01-01T00:00:00.000Z" }),
      meal({ id: "2", name: "salad", created_at: "2026-01-02T00:00:00.000Z" }),
      meal({ id: "3", name: "Soup", created_at: "2026-01-03T00:00:00.000Z" }),
      meal({ id: "4", name: "soup", created_at: "2026-01-03T00:00:00.000Z" }),
      meal({ id: "5", name: "Apple bake", created_at: "2026-01-04T00:00:00.000Z" }),
    ];
    const expected = ids(sortMealsByName(base));
    // Every rotation + its reverse: all must produce byte-identical ordering.
    for (let shift = 0; shift < base.length; shift += 1) {
      const rotated = [...base.slice(shift), ...base.slice(0, shift)];
      expect(ids(sortMealsByName(rotated))).toEqual(expected);
      expect(ids(sortMealsByName([...rotated].reverse()))).toEqual(expected);
    }
  });

  it("returns a NEW array and does not mutate the input array or its order", () => {
    const input = [meal({ name: "Zebra cake" }), meal({ name: "Apple bake" })];
    const snapshot = names(input);
    const sorted = sortMealsByName(input);
    expect(sorted).not.toBe(input);
    expect(names(input)).toEqual(snapshot); // Array.prototype.sort mutates in place; proves the copy.
    expect(names(sorted)).toEqual(["Apple bake", "Zebra cake"]);
  });

  it("handles an empty library and a single meal", () => {
    expect(sortMealsByName([])).toEqual([]);
    expect(names(sortMealsByName([meal({ name: "Only one" })]))).toEqual(["Only one"]);
  });

  it("orders leading digits, accents and punctuation without throwing (names are free text)", () => {
    const sorted = sortMealsByName([
      meal({ name: "3-egg omelette" }),
      meal({ name: "Ambar bowl" }),
      meal({ name: "  leading space" }),
    ]);
    expect(sorted).toHaveLength(3);
    expect(new Set(names(sorted)).size).toBe(3); // nothing dropped or duplicated
  });
});

describe("filterMealsByName (Phase 7c)", () => {
  const library = [
    meal({ id: "cr", name: "Chicken and rice" }),
    meal({ id: "bs", name: "Beef stew" }),
    meal({ id: "cs", name: "Chicken salad" }),
    meal({ id: "op", name: "Overnight oats" }),
  ];

  it("returns the input UNCHANGED for an empty query (identity, NOT no-results)", () => {
    // 6 calls this out as "the bug that would blank the page on focus".
    expect(ids(filterMealsByName(library, ""))).toEqual(ids(library));
  });

  it("returns the input UNCHANGED for a whitespace-only query", () => {
    expect(ids(filterMealsByName(library, "   "))).toEqual(ids(library));
    expect(ids(filterMealsByName(library, "\t \n "))).toEqual(ids(library));
  });

  it("preserves the incoming ORDER (it narrows a pre-sorted list, it does not re-order)", () => {
    const preSorted = sortMealsByName(library);
    expect(ids(filterMealsByName(preSorted, "chicken"))).toEqual(["cr", "cs"]);
  });

  it("matches case-insensitively in BOTH directions (query case and name case)", () => {
    expect(ids(filterMealsByName(library, "CHICKEN"))).toEqual(["cr", "cs"]);
    expect(ids(filterMealsByName(library, "chicken"))).toEqual(["cr", "cs"]);
    expect(ids(filterMealsByName(library, "ChIcKeN"))).toEqual(["cr", "cs"]);
    expect(ids(filterMealsByName([meal({ id: "up", name: "TUNA MELT" })], "tuna"))).toEqual(["up"]);
  });

  it("is a SUBSTRING match, not a prefix match (rice finds Chicken and rice)", () => {
    expect(ids(filterMealsByName(library, "rice"))).toEqual(["cr"]);
    expect(ids(filterMealsByName(library, "tew"))).toEqual(["bs"]); // mid-word, not a word boundary
  });

  it("ANDs multiple tokens -- every token must be a substring, not just one of them", () => {
    // 6: "chick rice" matches "Chicken and rice"; "chick beef" does not.
    expect(ids(filterMealsByName(library, "chick rice"))).toEqual(["cr"]);
    expect(filterMealsByName(library, "chick beef")).toEqual([]);
  });

  it("does NOT fall back to OR when only one token matches", () => {
    // The most likely wrong implementation (tokens.some) returns BOTH chicken meals here, because
    // "chicken" alone matches them. AND semantics must return only the one matching both tokens.
    expect(ids(filterMealsByName(library, "chicken rice"))).toEqual(["cr"]);
    expect(ids(filterMealsByName(library, "chicken salad"))).toEqual(["cs"]);
  });

  it("is order-independent across tokens", () => {
    expect(ids(filterMealsByName(library, "rice chicken"))).toEqual(["cr"]);
    expect(ids(filterMealsByName(library, "chicken rice"))).toEqual(["cr"]);
  });

  it("tolerates surrounding and repeated internal whitespace", () => {
    expect(ids(filterMealsByName(library, "  chicken   rice  "))).toEqual(["cr"]);
    expect(ids(filterMealsByName(library, "\tchicken\n\nrice "))).toEqual(["cr"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterMealsByName(library, "zzzz")).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [...library];
    const snapshot = ids(input);
    filterMealsByName(input, "chicken");
    expect(ids(input)).toEqual(snapshot);
    expect(input).toHaveLength(4);
  });

  it("treats the query as a literal substring, not a pattern (regex metacharacters)", () => {
    // A RegExp-based implementation would throw on an unbalanced paren and would treat "." as
    // any-character. Both are realistic in free-text meal names.
    const withParens = [
      meal({ id: "p", name: "Chicken (spicy)" }),
      meal({ id: "d", name: "Dr. Pepper float" }),
      meal({ id: "x", name: "Drx Pepper float" }),
    ];
    expect(() => filterMealsByName(withParens, "(spicy")).not.toThrow();
    expect(ids(filterMealsByName(withParens, "(spicy"))).toEqual(["p"]);
    expect(ids(filterMealsByName(withParens, "dr."))).toEqual(["d"]); // "." literal, not a wildcard
    expect(ids(filterMealsByName(withParens, "a+"))).toEqual([]);
  });

  it("matches only on the meal NAME -- no other Meal field is searchable", () => {
    // Item-name matching is deliberately deferred (4 / 8 Phase 7c "Out"); the domain function is
    // only ever given Meal rows, so the guard here is that no OTHER field leaks into the match.
    const m = meal({
      id: "only-name",
      name: "Breakfast",
      user_id: "tuna-user-id",
      created_at: "2026-09-09T00:00:00.000Z",
    });
    expect(filterMealsByName([m], "tuna")).toEqual([]);
    expect(filterMealsByName([m], "2026")).toEqual([]);
    expect(filterMealsByName([m], "only-name")).toEqual([]);
    expect(ids(filterMealsByName([m], "break"))).toEqual(["only-name"]);
  });

  it("handles an empty library", () => {
    expect(filterMealsByName([], "chicken")).toEqual([]);
    expect(filterMealsByName([], "")).toEqual([]);
  });

  it("scales to a 60-meal library without dropping matches (no incidental cap in the pure layer)", () => {
    const big = Array.from({ length: 60 }, (_, i) =>
      meal({ id: "m" + i, name: "Meal " + String(i).padStart(2, "0") + " chicken" }),
    );
    expect(filterMealsByName(big, "chicken")).toHaveLength(60);
    expect(filterMealsByName(big, "")).toHaveLength(60);
    expect(sortMealsByName(big)).toHaveLength(60);
  });
});

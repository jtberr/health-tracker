import { describe, expect, it } from "vitest";
import { groupByConsumedAt } from "./entry-grouping";
import type { FoodEntry } from "@/lib/types";

function makeEntry(overrides: Partial<FoodEntry> & { id: string; consumed_at: string }): FoodEntry {
  return {
    user_id: "u1",
    name: "Food",
    quantity: 1,
    unit: null,
    calories_per_unit: 100,
    protein_g_per_unit: 10,
    calories: 100,
    protein_g: 10,
    consumed_tz: "America/New_York",
    consumed_local_date: "2026-07-15",
    logged_from_meal_id: null,
    created_at: "2026-07-15T12:00:00Z",
    updated_at: "2026-07-15T12:00:00Z",
    ...overrides,
  };
}

describe("groupByConsumedAt", () => {
  it("returns an empty array for no entries", () => {
    expect(groupByConsumedAt([])).toEqual([]);
  });

  it("puts entries with an identical consumed_at into one group", () => {
    const a = makeEntry({ id: "a", consumed_at: "2026-07-15T12:00:00Z" });
    const b = makeEntry({ id: "b", consumed_at: "2026-07-15T12:00:00Z" });
    const groups = groupByConsumedAt([a, b]);
    expect(groups).toHaveLength(1);
    expect(groups[0].entries.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("puts entries at distinct instants into separate groups", () => {
    const a = makeEntry({ id: "a", consumed_at: "2026-07-15T08:00:00Z" });
    const b = makeEntry({ id: "b", consumed_at: "2026-07-15T12:00:00Z" });
    const groups = groupByConsumedAt([a, b]);
    expect(groups).toHaveLength(2);
  });

  it("handles the 'every 30 minutes for 3 hours' case as one group per distinct instant (no arbitrary chunking)", () => {
    const entries: FoodEntry[] = [];
    for (let i = 0; i < 7; i++) {
      const minutes = i * 30;
      const hh = String(8 + Math.floor(minutes / 60)).padStart(2, "0");
      const mm = String(minutes % 60).padStart(2, "0");
      entries.push(makeEntry({ id: `e${i}`, consumed_at: `2026-07-15T${hh}:${mm}:00Z` }));
    }
    const groups = groupByConsumedAt(entries);
    expect(groups).toHaveLength(7);
    for (const group of groups) {
      expect(group.entries).toHaveLength(1);
    }
  });

  it("groups identical-instant entries regardless of insertion order", () => {
    const a = makeEntry({ id: "a", consumed_at: "2026-07-15T12:00:00Z" });
    const mid = makeEntry({ id: "mid", consumed_at: "2026-07-15T09:00:00Z" });
    const b = makeEntry({ id: "b", consumed_at: "2026-07-15T12:00:00Z" });
    const groups = groupByConsumedAt([a, mid, b]);
    expect(groups).toHaveLength(2);
    const noonGroup = groups.find((g) => g.consumedAt === "2026-07-15T12:00:00Z");
    expect(noonGroup?.entries.map((e) => e.id)).toEqual(["a", "b"]);
  });

  it("orders groups chronologically regardless of input order", () => {
    const late = makeEntry({ id: "late", consumed_at: "2026-07-15T18:00:00Z" });
    const early = makeEntry({ id: "early", consumed_at: "2026-07-15T07:00:00Z" });
    const mid = makeEntry({ id: "mid", consumed_at: "2026-07-15T12:00:00Z" });
    const groups = groupByConsumedAt([late, early, mid]);
    expect(groups.map((g) => g.consumedAt)).toEqual([
      "2026-07-15T07:00:00Z",
      "2026-07-15T12:00:00Z",
      "2026-07-15T18:00:00Z",
    ]);
  });
});

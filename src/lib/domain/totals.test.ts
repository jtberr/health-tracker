import { describe, expect, it } from "vitest";
import { sumEntries } from "./totals";
import type { FoodEntry } from "@/lib/types";

function makeEntry(calories: number, proteinG: number): Pick<FoodEntry, "calories" | "protein_g"> {
  return { calories, protein_g: proteinG };
}

describe("sumEntries", () => {
  it("returns zeros for an empty list", () => {
    expect(sumEntries([])).toEqual({ calories: 0, proteinG: 0 });
  });

  it("sums a single entry", () => {
    expect(sumEntries([makeEntry(200, 30)])).toEqual({ calories: 200, proteinG: 30 });
  });

  it("sums multiple entries", () => {
    const entries = [makeEntry(200, 30), makeEntry(300, 10), makeEntry(150, 5)];
    expect(sumEntries(entries)).toEqual({ calories: 650, proteinG: 45 });
  });

  it("sums fractional protein values", () => {
    const entries = [makeEntry(100, 12.5), makeEntry(50, 6.25)];
    expect(sumEntries(entries)).toEqual({ calories: 150, proteinG: 18.75 });
  });
});

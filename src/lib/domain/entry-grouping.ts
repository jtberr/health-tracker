import type { FoodEntry } from "@/lib/types";

/**
 * Pure, framework-free exact-timestamp meal grouping. No Next.js/React/Supabase imports —
 * primary unit-test target per AGENTS.md.
 *
 * Replaces an earlier >90-minute gap-heuristic design (see ai-context/DECISIONS.md "Meal
 * grouping of logged entries by exact `consumed_at` ..."): entries that share the *exact same*
 * `consumed_at` instant are one meal group. Fully deterministic, no threshold, no stored column
 * — this is derived-only presentation logic over the existing indexed `consumed_at`.
 */

export type EntryGroup = {
  consumedAt: string;
  entries: FoodEntry[];
};

/**
 * Groups `entries` by exact-match `consumed_at`. Group order is chronological (ascending
 * `consumedAt`); within a group, entries keep their relative input order (stable grouping,
 * regardless of insertion order across entries with the same instant).
 */
export function groupByConsumedAt(entries: FoodEntry[]): EntryGroup[] {
  const byInstant = new Map<string, FoodEntry[]>();

  for (const entry of entries) {
    const key = entry.consumed_at;
    const existing = byInstant.get(key);
    if (existing) {
      existing.push(entry);
    } else {
      byInstant.set(key, [entry]);
    }
  }

  return Array.from(byInstant.entries())
    .map(([consumedAt, groupEntries]) => ({ consumedAt, entries: groupEntries }))
    .sort((a, b) => new Date(a.consumedAt).getTime() - new Date(b.consumedAt).getTime());
}

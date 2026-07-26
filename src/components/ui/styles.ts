/**
 * Shared className constants for form fields, used across FoodEntryForm/MetricForm/SettingsForm
 * so labels/inputs/errors look identical everywhere without each form redeclaring the same string.
 */
export const labelClass = "text-sm font-medium text-stone-700";
// NB-2 fix (qa-reviewer, 2026-07-26): border-zinc-300 measured 1.49:1 on white (needs 3:1 for the
// WCAG 1.4.11 non-text/UI-component threshold) and placeholder:text-stone-400 measured 2.52:1 on
// white (needs 4.5:1 for AA text). Tailwind's stone-500 (#78716c) is the nearest step up in the
// same warm-neutral family that clears both bars: 4.80:1 on white for the border (>=3:1) and
// 4.80:1 on white for placeholder text (>=4.5:1) — see ai-context/DECISIONS.md for the full
// before/after math and the amendment to the original "field-border grays... stay" carve-out.
export const inputClass =
  "rounded-lg border border-stone-500 bg-white px-3 py-2 text-sm text-ink shadow-sm transition-colors placeholder:text-stone-500 focus:border-sage-deep focus:outline-none focus:ring-2 focus:ring-sage-deep/20";
export const errorTextClass = "text-sm text-red-600";

/**
 * Shared className constants for form fields, used across FoodEntryForm/MetricForm/SettingsForm
 * so labels/inputs/errors look identical everywhere without each form redeclaring the same string.
 *
 * Phase 8i (2026-08-09/10, "Visual identity v2"): labelClass -> text-ink (was text-stone-700);
 * inputClass border/focus -> `--line-strong`/`--accent` tokens (was stone-500/sage-deep, the
 * 2026-07-26 NB-2 fix's border+placeholder shade) — a genuine UI component, so it keeps the
 * >=3:1/>=4.5:1 guarantees NB-2 established, just re-pointed at the new token set. See
 * ai-context/DECISIONS.md's Phase 8i entry for the full ratio table.
 */
export const labelClass = "text-sm font-medium text-ink";
export const inputClass =
  "rounded-lg border border-line-strong bg-white px-3 py-2 text-sm text-ink shadow-sm transition-colors placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";
export const errorTextClass = "text-sm text-red-600";

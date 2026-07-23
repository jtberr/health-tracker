/**
 * Shared className constants for form fields, used across FoodEntryForm/MetricForm/SettingsForm
 * so labels/inputs/errors look identical everywhere without each form redeclaring the same string.
 */
export const labelClass = "text-sm font-medium text-zinc-700";
export const inputClass =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm transition-colors placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20";
export const errorTextClass = "text-sm text-red-600";

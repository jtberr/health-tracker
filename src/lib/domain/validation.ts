/**
 * Pure, framework-free validation for the food-entry form. No Next.js/React/Supabase imports —
 * primary unit-test target per AGENTS.md.
 *
 * Validates the *final* stored shape (name, quantity, per-unit calories/protein, date/time) —
 * i.e. after the caller has already resolved the "per-unit vs. total" input mode down to
 * per-unit values (see `quantity.ts`), since only one storage model exists (§4 "Quantity + unit
 * as first-class fields"). Deliberately does NOT check the no-future-day cap — that's tz-aware
 * (`datetime.localDateNotAfterToday`) and applied separately by the caller (server action), so
 * this module stays framework-free and doesn't need an injected "now".
 */

export type FoodEntryField =
  | "name"
  | "quantity"
  | "caloriesPerUnit"
  | "proteinGPerUnit"
  | "consumedDate"
  | "consumedTime";

export type FoodEntryFieldError = { field: FoodEntryField; message: string };
export type FoodEntryValidationResult = { ok: true } | { ok: false; errors: FoodEntryFieldError[] };

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export type FoodEntryInput = {
  name: string;
  quantity: number;
  caloriesPerUnit: number;
  proteinGPerUnit: number;
  consumedDate: string;
  consumedTime: string;
};

export function validateFoodEntryInput(input: FoodEntryInput): FoodEntryValidationResult {
  const errors: FoodEntryFieldError[] = [];

  if (!input.name.trim()) {
    errors.push({ field: "name", message: "Name is required." });
  }

  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    errors.push({ field: "quantity", message: "Quantity must be greater than 0." });
  }

  if (!Number.isFinite(input.caloriesPerUnit) || input.caloriesPerUnit < 0) {
    errors.push({ field: "caloriesPerUnit", message: "Calories can't be negative." });
  }

  if (!Number.isFinite(input.proteinGPerUnit) || input.proteinGPerUnit < 0) {
    errors.push({ field: "proteinGPerUnit", message: "Protein can't be negative." });
  }

  if (!DATE_PATTERN.test(input.consumedDate)) {
    errors.push({ field: "consumedDate", message: "Enter a valid date." });
  }

  if (!TIME_PATTERN.test(input.consumedTime)) {
    errors.push({ field: "consumedTime", message: "Enter a valid time." });
  } else {
    const minutes = Number(input.consumedTime.slice(3, 5));
    if (minutes % 15 !== 0) {
      errors.push({ field: "consumedTime", message: "Time must be on a 15-minute interval." });
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

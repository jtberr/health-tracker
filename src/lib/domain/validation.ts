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

/**
 * Validates a `daily_metrics` upsert (Phase 4 — "Weight/body-fat logging + goals/settings").
 * `weight` is the raw number the user typed, **in whichever display unit they're using** — a
 * "greater than 0" check is unit-agnostic (kg and lb are both positive scalings of the same
 * quantity), so this stays framework-free and doesn't need to import `units.ts`'s conversion.
 * Deliberately does NOT check the no-future-day cap here — that's tz-aware
 * (`datetime.localDateNotAfterToday`) and applied separately by the caller (server action), same
 * as `validateFoodEntryInput`.
 */
export type DailyMetricField = "metricDate" | "weight" | "bodyFatPct";
export type DailyMetricFieldError = { field: DailyMetricField; message: string };
export type DailyMetricValidationResult = { ok: true } | { ok: false; errors: DailyMetricFieldError[] };

export type DailyMetricInput = {
  metricDate: string;
  /** Raw user-entered weight, in the user's current display unit (kg or lb) — see doc comment above. */
  weight: number;
  bodyFatPct: number | null;
};

export function validateDailyMetricInput(input: DailyMetricInput): DailyMetricValidationResult {
  const errors: DailyMetricFieldError[] = [];

  if (!DATE_PATTERN.test(input.metricDate)) {
    errors.push({ field: "metricDate", message: "Enter a valid date." });
  }

  if (!Number.isFinite(input.weight) || input.weight <= 0) {
    errors.push({ field: "weight", message: "Weight must be greater than 0." });
  }

  if (input.bodyFatPct !== null) {
    if (!Number.isFinite(input.bodyFatPct) || input.bodyFatPct < 0 || input.bodyFatPct > 100) {
      errors.push({ field: "bodyFatPct", message: "Body fat % must be between 0 and 100." });
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/**
 * Validates a `user_goals` update (Phase 4). Both targets are optional (nullable columns) — a
 * blank field means "no goal set", not zero.
 */
export type GoalsField = "dailyCalorieTarget" | "dailyProteinTargetG";
export type GoalsFieldError = { field: GoalsField; message: string };
export type GoalsValidationResult = { ok: true } | { ok: false; errors: GoalsFieldError[] };

export type GoalsInput = {
  dailyCalorieTarget: number | null;
  dailyProteinTargetG: number | null;
};

export function validateGoalsInput(input: GoalsInput): GoalsValidationResult {
  const errors: GoalsFieldError[] = [];

  if (input.dailyCalorieTarget !== null) {
    if (!Number.isFinite(input.dailyCalorieTarget) || input.dailyCalorieTarget < 0) {
      errors.push({ field: "dailyCalorieTarget", message: "Calorie target must be zero or greater." });
    } else if (!Number.isInteger(input.dailyCalorieTarget)) {
      errors.push({ field: "dailyCalorieTarget", message: "Calorie target must be a whole number." });
    }
  }

  if (input.dailyProteinTargetG !== null) {
    if (!Number.isFinite(input.dailyProteinTargetG) || input.dailyProteinTargetG < 0) {
      errors.push({ field: "dailyProteinTargetG", message: "Protein target must be zero or greater." });
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/**
 * Validates a `meals` create/rename (Phase 7 — "Saved meals"). Name only — items are validated
 * separately via `validateMealItemInput`.
 */
export type MealField = "name";
export type MealFieldError = { field: MealField; message: string };
export type MealValidationResult = { ok: true } | { ok: false; errors: MealFieldError[] };
export type MealInput = { name: string };

export function validateMealInput(input: MealInput): MealValidationResult {
  const errors: MealFieldError[] = [];

  if (!input.name.trim()) {
    errors.push({ field: "name", message: "Name is required." });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/**
 * Validates a `meal_items` add/edit (Phase 7). Deliberately the same shape as
 * `validateFoodEntryInput` minus the date/time fields — a saved-meal item has no `consumed_at` at
 * all (time-of-day is chosen only at log time, in `LogMealDialog`); like `validateFoodEntryInput`,
 * this validates the *final* per-unit shape after the caller has already resolved the
 * per-unit-vs-total input mode (`quantity.perUnitFromTotal`).
 */
export type MealItemField = "name" | "quantity" | "caloriesPerUnit" | "proteinGPerUnit";
export type MealItemFieldError = { field: MealItemField; message: string };
export type MealItemValidationResult = { ok: true } | { ok: false; errors: MealItemFieldError[] };

export type MealItemInput = {
  name: string;
  quantity: number;
  caloriesPerUnit: number;
  proteinGPerUnit: number;
};

export function validateMealItemInput(input: MealItemInput): MealItemValidationResult {
  const errors: MealItemFieldError[] = [];

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

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

/**
 * Validates `logMealForDay`'s form input (Phase 7) — which meal, and the date/time to log it at.
 * Reuses the same `DATE_PATTERN`/`TIME_PATTERN`/15-minute-grid rules `validateFoodEntryInput`
 * applies to `consumedDate`/`consumedTime`, since a logged meal batch shares one `consumed_at`
 * with the exact same shape/constraints as a single food entry's. Deliberately does NOT check the
 * no-future-day cap here — same convention as the other validators in this module: that's
 * tz-aware (`datetime.localDateNotAfterToday`) and applied by the caller (the server action).
 */
export type LogMealField = "mealId" | "logDate" | "logTime";
export type LogMealFieldError = { field: LogMealField; message: string };
export type LogMealValidationResult = { ok: true } | { ok: false; errors: LogMealFieldError[] };

export type LogMealInput = {
  mealId: string;
  logDate: string;
  logTime: string;
};

export function validateLogMealInput(input: LogMealInput): LogMealValidationResult {
  const errors: LogMealFieldError[] = [];

  if (!input.mealId.trim()) {
    errors.push({ field: "mealId", message: "Choose a meal to log." });
  }

  if (!DATE_PATTERN.test(input.logDate)) {
    errors.push({ field: "logDate", message: "Enter a valid date." });
  }

  if (!TIME_PATTERN.test(input.logTime)) {
    errors.push({ field: "logTime", message: "Enter a valid time." });
  } else {
    const minutes = Number(input.logTime.slice(3, 5));
    if (minutes % 15 !== 0) {
      errors.push({ field: "logTime", message: "Time must be on a 15-minute interval." });
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

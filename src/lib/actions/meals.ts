"use server";

import { createClient } from "@/lib/supabase/server";
import { isValidTimeZone, localDateNotAfterToday, localInputToUtcInTz } from "@/lib/domain/datetime";
import { computeReorderedSortOrders } from "@/lib/domain/meal-items";
import { perUnitFromTotal } from "@/lib/domain/quantity";
import {
  validateLogMealInput,
  validateMealInput,
  validateMealItemInput,
  type LogMealField,
  type MealField,
  type MealItemField,
} from "@/lib/domain/validation";
import type { FoodEntry, Meal, MealItem } from "@/lib/types";

/**
 * Server Actions for `meals`/`meal_items` CRUD and `logMealForDay` (Phase 7 — "Saved meals"),
 * following the same shape every prior phase's actions established (`lib/actions/food.ts`/
 * `metrics.ts`/`goals.ts`): a typed `*ActionState` consumed via `useActionState`, `FormData` in,
 * `user_id` only ever from the authenticated server-side session (never client input —
 * AGENTS.md Absolute Rules).
 *
 * **The single most important thing in this file** is the app-layer ownership invariant on
 * `food_entries.logged_from_meal_id` (ai-context/DECISIONS.md "`food_entries.logged_from_meal_id`
 * stays a plain FK..." and docs/architecture/food-weight-tracker.md §8 Phase 7): that column is a
 * plain FK with **no** DB-level ownership check (unlike `meal_items.meal_id`'s composite
 * `(meal_id, user_id)` FK), so `logMealForDay` below is the enforcement point. It resolves the
 * meal *and* its items via the same RLS-scoped `supabase` client used for the session check above
 * — **never** the service-role client, which would bypass RLS — strictly *before* any insert. RLS
 * on `meals`/`meal_items` already restricts `select` to the caller's own rows, so a foreign or
 * nonexistent meal id resolves to zero rows here, indistinguishable from "not found" — which is
 * exactly the generic error this returns, with zero `food_entries` rows written. This is what
 * makes every `logged_from_meal_id` value same-owner *by construction*: there is no code path in
 * this file that inserts a row referencing a meal that wasn't just proven to be the caller's own.
 */

export type MealActionState = {
  ok: boolean;
  error: string | null;
  fieldErrors?: Partial<Record<MealField, string>>;
  meal?: Meal;
};

export type MealItemActionState = {
  ok: boolean;
  error: string | null;
  fieldErrors?: Partial<Record<MealItemField, string>>;
  item?: MealItem;
};

export type LogMealActionState = {
  ok: boolean;
  error: string | null;
  fieldErrors?: Partial<Record<LogMealField, string>>;
  entries?: FoodEntry[];
};

export type MealsActionResult = { ok: boolean; error: string | null };

// -------------------------------------------------------------------------------------------
// meals CRUD
// -------------------------------------------------------------------------------------------

export async function createMeal(
  _prevState: MealActionState,
  formData: FormData,
): Promise<MealActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "unauthenticated" };
  }

  const name = String(formData.get("name") ?? "").trim();
  const validation = validateMealInput({ name });
  if (!validation.ok) {
    const fieldErrors: Partial<Record<MealField, string>> = {};
    for (const e of validation.errors) fieldErrors[e.field] = e.message;
    return { ok: false, error: "Please fix the errors below.", fieldErrors };
  }

  const { data, error } = await supabase
    .from("meals")
    .insert({ user_id: user.id, name })
    .select()
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, error: null, meal: data as Meal };
}

export async function updateMeal(
  _prevState: MealActionState,
  formData: FormData,
): Promise<MealActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "unauthenticated" };
  }

  const id = String(formData.get("id") ?? "");
  if (!id) {
    return { ok: false, error: "Missing meal id." };
  }

  const name = String(formData.get("name") ?? "").trim();
  const validation = validateMealInput({ name });
  if (!validation.ok) {
    const fieldErrors: Partial<Record<MealField, string>> = {};
    for (const e of validation.errors) fieldErrors[e.field] = e.message;
    return { ok: false, error: "Please fix the errors below.", fieldErrors };
  }

  // `.eq("user_id", user.id)` is belt-and-suspenders alongside RLS, same convention as every
  // other update/delete in this codebase (`lib/actions/food.ts`, `metrics.ts`).
  const { data, error } = await supabase
    .from("meals")
    .update({ name })
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, error: null, meal: data as Meal };
}

export async function deleteMeal(id: string): Promise<MealsActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "unauthenticated" };
  }

  // `meal_items` cascades at the DB level (`ON DELETE CASCADE`, Phase 2 migration); already-logged
  // `food_entries.logged_from_meal_id` referencing this meal are set null (`ON DELETE SET NULL`) —
  // the logged rows themselves are untouched, since they hold copied values, not a live reference.
  const { error } = await supabase.from("meals").delete().eq("id", id).eq("user_id", user.id);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, error: null };
}

// -------------------------------------------------------------------------------------------
// meal_items CRUD
// -------------------------------------------------------------------------------------------

type ParsedMealItemForm =
  | { ok: true; value: MealItemWritePayload }
  | { ok: false; state: MealItemActionState };

type MealItemWritePayload = {
  name: string;
  quantity: number;
  unit: string | null;
  caloriesPerUnit: number;
  proteinGPerUnit: number;
};

function parseAndValidateMealItemForm(formData: FormData): ParsedMealItemForm {
  const name = String(formData.get("name") ?? "");
  const quantityRaw = String(formData.get("quantity") ?? "").trim();
  const quantity = quantityRaw === "" ? 1 : Number(quantityRaw);
  const unitRaw = String(formData.get("unit") ?? "").trim();
  const unit = unitRaw === "" ? null : unitRaw;
  const mode = String(formData.get("mode") ?? "total") === "perUnit" ? "perUnit" : "total";
  const caloriesInput = Number(formData.get("calories"));
  const proteinInput = Number(formData.get("protein"));

  // Same two input modes as `food.ts`'s `FoodEntryForm` — "total" means the submitted
  // calories/protein are a total for the current quantity and get converted to per-unit here;
  // "perUnit" means they're already per-unit. Exactly one storage model either way.
  const caloriesPerUnit = mode === "perUnit" ? caloriesInput : perUnitFromTotal(caloriesInput, quantity);
  const proteinGPerUnit = mode === "perUnit" ? proteinInput : perUnitFromTotal(proteinInput, quantity);

  const validation = validateMealItemInput({ name, quantity, caloriesPerUnit, proteinGPerUnit });
  if (!validation.ok) {
    const fieldErrors: Partial<Record<MealItemField, string>> = {};
    for (const e of validation.errors) fieldErrors[e.field] = e.message;
    return {
      ok: false,
      state: { ok: false, error: "Please fix the errors below.", fieldErrors },
    };
  }

  return {
    ok: true,
    value: { name: name.trim(), quantity, unit, caloriesPerUnit, proteinGPerUnit },
  };
}

export async function addMealItem(
  _prevState: MealItemActionState,
  formData: FormData,
): Promise<MealItemActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "unauthenticated" };
  }

  const mealId = String(formData.get("mealId") ?? "");
  if (!mealId) {
    return { ok: false, error: "Missing meal id." };
  }

  const parsed = parseAndValidateMealItemForm(formData);
  if (!parsed.ok) return parsed.state;

  // New items append to the end of the meal — one extra read to find the current max sort_order
  // (RLS + the belt-and-suspenders `user_id` filter both scope this to the caller's own items).
  // Using max+1 (not `count`) is defensive against gaps left by prior deletes.
  const { data: existing } = await supabase
    .from("meal_items")
    .select("sort_order")
    .eq("meal_id", mealId)
    .eq("user_id", user.id)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSortOrder = existing && existing.length > 0 ? existing[0].sort_order + 1 : 0;

  // Note on ownership: `meal_items.meal_id` requires a *matching* `(meal_id, user_id)` row to
  // exist in `meals` (the composite FK from the Phase 2 migration) — since `user_id` here is
  // always the caller's own session id, inserting an item under a `mealId` owned by someone else
  // fails this FK constraint outright, surfaced below as an ordinary `error.message`.
  const { data, error } = await supabase
    .from("meal_items")
    .insert({
      meal_id: mealId,
      user_id: user.id,
      name: parsed.value.name,
      quantity: parsed.value.quantity,
      unit: parsed.value.unit,
      calories_per_unit: parsed.value.caloriesPerUnit,
      protein_g_per_unit: parsed.value.proteinGPerUnit,
      sort_order: nextSortOrder,
    })
    .select()
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, error: null, item: data as MealItem };
}

export async function updateMealItem(
  _prevState: MealItemActionState,
  formData: FormData,
): Promise<MealItemActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "unauthenticated" };
  }

  const id = String(formData.get("id") ?? "");
  if (!id) {
    return { ok: false, error: "Missing item id." };
  }

  const parsed = parseAndValidateMealItemForm(formData);
  if (!parsed.ok) return parsed.state;

  // `meal_id` is deliberately not updatable here — moving an item to a different meal is out of
  // this phase's scope; editing only ever touches the item's own name/quantity/unit/per-unit.
  const { data, error } = await supabase
    .from("meal_items")
    .update({
      name: parsed.value.name,
      quantity: parsed.value.quantity,
      unit: parsed.value.unit,
      calories_per_unit: parsed.value.caloriesPerUnit,
      protein_g_per_unit: parsed.value.proteinGPerUnit,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, error: null, item: data as MealItem };
}

export async function deleteMealItem(id: string): Promise<MealsActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "unauthenticated" };
  }

  const { error } = await supabase.from("meal_items").delete().eq("id", id).eq("user_id", user.id);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, error: null };
}

export async function reorderMealItems(
  mealId: string,
  orderedIds: string[],
): Promise<MealsActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "unauthenticated" };
  }

  const assignments = computeReorderedSortOrders(orderedIds);

  const results = await Promise.all(
    assignments.map(({ id, sortOrder }) =>
      supabase
        .from("meal_items")
        .update({ sort_order: sortOrder })
        .eq("id", id)
        .eq("meal_id", mealId)
        .eq("user_id", user.id),
    ),
  );

  const failed = results.find((r) => r.error);
  if (failed?.error) {
    return { ok: false, error: failed.error.message };
  }

  return { ok: true, error: null };
}

// -------------------------------------------------------------------------------------------
// logMealForDay — the ownership-invariant enforcement point (see file doc comment above)
// -------------------------------------------------------------------------------------------

export async function logMealForDay(
  _prevState: LogMealActionState,
  formData: FormData,
): Promise<LogMealActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "unauthenticated" };
  }

  const mealId = String(formData.get("mealId") ?? "");
  const logDate = String(formData.get("logDate") ?? "");
  const logTime = String(formData.get("logTime") ?? "");
  const logTz = String(formData.get("logTz") ?? "").trim();

  const validation = validateLogMealInput({ mealId, logDate, logTime });
  if (!validation.ok) {
    const fieldErrors: Partial<Record<LogMealField, string>> = {};
    for (const e of validation.errors) fieldErrors[e.field] = e.message;
    return { ok: false, error: "Please fix the errors below.", fieldErrors };
  }

  if (!logTz) {
    return { ok: false, error: "Missing time zone." };
  }

  // A tampered/garbled tz (e.g. a hostile client overwriting the hidden logTz field) must fail
  // gracefully here, BEFORE it ever reaches localDateNotAfterToday/localInputToUtcInTz below —
  // both call through to Intl.DateTimeFormat internally, which throws a RangeError on an invalid
  // timeZone. Left unchecked, that throw propagates out of this Server Action uncaught, surfacing
  // a generic Next.js error page instead of a graceful result — exactly the same gap
  // `lib/actions/food.ts`'s add/edit actions had, fixed identically here (see datetime.ts's
  // `isValidTimeZone` doc comment).
  if (!isValidTimeZone(logTz)) {
    return { ok: false, error: "invalid_timezone" };
  }

  // No-future-day cap on the whole batch (ai-context/DECISIONS.md "No logging into the future
  // ..."): checked up-front, before any read/insert, exactly like `food.ts`'s add/edit actions.
  if (!localDateNotAfterToday(logDate, logTz)) {
    return { ok: false, error: "future_date" };
  }

  // --- Ownership invariant (see file doc comment): resolve the meal, and only the meal, via the
  // RLS-scoped `supabase` client already bound to this request's session. RLS's
  // `meals_select_own` policy means a mealId belonging to another user (or one that doesn't
  // exist at all) simply returns zero rows here — not an error, not a leak of "exists but isn't
  // yours" vs. "doesn't exist" — both collapse to the same generic `meal_not_found`, with no
  // insert ever attempted. The extra `.eq("user_id", user.id)` is belt-and-suspenders on top of
  // RLS, matching this file's other mutations and making the invariant visible at the call site
  // without having to know the RLS policy exists.
  const { data: meal, error: mealError } = await supabase
    .from("meals")
    .select("id")
    .eq("id", mealId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (mealError) {
    return { ok: false, error: mealError.message };
  }
  if (!meal) {
    return { ok: false, error: "meal_not_found" };
  }

  const { data: items, error: itemsError } = await supabase
    .from("meal_items")
    .select("*")
    .eq("meal_id", mealId)
    .eq("user_id", user.id)
    .order("sort_order", { ascending: true });

  if (itemsError) {
    return { ok: false, error: itemsError.message };
  }
  // An empty meal must be rejected outright, not silently loggable as a zero-item batch.
  if (!items || items.length === 0) {
    return { ok: false, error: "empty_meal" };
  }

  const consumedAt = localInputToUtcInTz(logDate, logTime, logTz);

  const rows = (items as MealItem[]).map((item) => ({
    user_id: user.id,
    name: item.name,
    quantity: item.quantity,
    unit: item.unit,
    calories_per_unit: item.calories_per_unit,
    protein_g_per_unit: item.protein_g_per_unit,
    consumed_at: consumedAt,
    consumed_tz: logTz,
    // Safe by construction: `mealId` was just proven to resolve to one of the caller's own
    // meals, through the RLS-scoped client, above — never the service-role client.
    logged_from_meal_id: mealId,
  }));

  // A single multi-row INSERT is one Postgres statement — it either inserts every row or none
  // (atomic per-statement), which is what "future-cap applies to the whole batch" / "cross-user
  // rejection writes zero rows" both rely on; there is no insert call before this point.
  const { data: inserted, error: insertError } = await supabase
    .from("food_entries")
    .insert(rows)
    .select();

  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  return { ok: true, error: null, entries: (inserted ?? []) as FoodEntry[] };
}

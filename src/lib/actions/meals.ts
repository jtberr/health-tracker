"use server";

import { createClient } from "@/lib/supabase/server";
import { isValidTimeZone, localDateNotAfterToday, localInputToUtcInTz } from "@/lib/domain/datetime";
import { computeReorderedSortOrders, mealItemsFromEntries } from "@/lib/domain/meal-items";
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
 *
 * **`createMealFromEntries`** (Phase 7b — "Save a logged meal group as a Saved Meal") is the exact
 * mirror in the other direction: instead of trusting a client-supplied meal id, it re-reads the
 * `food_entries` rows it's asked to copy through the same RLS-scoped client, with a count check
 * that rejects the whole request (rather than silently writing a partial meal) if any requested id
 * doesn't resolve to one of the caller's own rows. It is strictly read-only on `food_entries` — no
 * UPDATE, no DELETE, no relink of `logged_from_meal_id` — by there simply being no such statement
 * in its code path (see ai-context/DECISIONS.md and the design doc's §3.3/§5 for the full
 * reasoning, including why a failed item-insert is handled with a compensating delete rather than
 * a database transaction).
 *
 * **`setMealPinned`/`duplicateMeal`** (Phase 8f — "Saved meals: pinning and duplicating") round
 * out the meal→meal direction. `duplicateMeal` is `createMealFromEntries`'s structural twin one
 * level up: id in, re-read via the RLS-scoped client, never client-supplied values, the same
 * `meal_not_found` code and compensating-delete contract — differing only in that `sort_order` is
 * *preserved* from the source (a saved meal already has a user-curated order; a food entry does
 * not), and `is_pinned` is never copied onto the duplicate. `setMealPinned` is a plain toggle with
 * no RLS policy of its own — see the migration comment and design doc §3.2 for why an ALTER on an
 * already-RLS-enabled table needs none, and why that claim must be verified by query, not assumed.
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
    return { ok: false, error: "Please fix the highlighted errors.", fieldErrors };
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
    return { ok: false, error: "Please fix the highlighted errors.", fieldErrors };
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
// createMealFromEntries — the entries→meal direction (Phase 7b, 2026-07-30). The exact mirror
// of logMealForDay below: that action resolves a *meal* through the RLS-scoped client before
// ever trusting it as a source of truth; this one resolves *entries* the same way before ever
// trusting them as the source of a new meal. See ai-context/DECISIONS.md "Saving an already-
// logged meal group as a Saved Meal..." and docs/architecture/food-weight-tracker.md §3.3.
// -------------------------------------------------------------------------------------------

export async function createMealFromEntries(
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
    return { ok: false, error: "Please fix the highlighted errors.", fieldErrors };
  }

  // Dedupe (the design doc's "unique(entryIds)") and drop any blank values a hostile/garbled
  // client might submit — neither should count toward the below count check.
  const entryIds = Array.from(
    new Set(formData.getAll("entryIds").map((v) => String(v)).filter((id) => id.length > 0)),
  );
  if (entryIds.length === 0) {
    return { ok: false, error: "no_entries" };
  }

  // --- Ownership re-check (see file doc comment / logMealForDay below for the same pattern):
  // resolve the entries via the RLS-scoped `supabase` client already bound to this request's
  // session — never the service-role client, never the client-supplied name/calorie values a
  // browser might have sent alongside the ids (those are display-only; only what's re-read here
  // ever reaches a write). RLS's `food_entries_select_own` policy means a foreign or nonexistent
  // id simply doesn't come back. The extra `.eq("user_id", user.id)` is belt-and-suspenders on
  // top of RLS, matching this file's other mutations.
  const { data: rows, error: entriesError } = await supabase
    .from("food_entries")
    .select("*")
    .in("id", entryIds)
    .eq("user_id", user.id);

  if (entriesError) {
    return { ok: false, error: entriesError.message };
  }

  // A foreign id, a nonexistent id, or a mixed own/foreign set all collapse to "fewer rows came
  // back than ids were requested" — reject the WHOLE request rather than silently creating a
  // partial meal from just the caller's own ids, which would look like it worked.
  if (!rows || rows.length !== entryIds.length) {
    return { ok: false, error: "entries_not_found" };
  }

  const drafts = mealItemsFromEntries(rows as FoodEntry[]);

  const { data: meal, error: mealError } = await supabase
    .from("meals")
    .insert({ user_id: user.id, name })
    .select()
    .single();

  if (mealError || !meal) {
    return { ok: false, error: mealError?.message ?? "Couldn't create the meal." };
  }

  const { error: itemsError } = await supabase.from("meal_items").insert(
    drafts.map((draft) => ({
      meal_id: (meal as Meal).id,
      user_id: user.id,
      name: draft.name,
      quantity: draft.quantity,
      unit: draft.unit,
      calories_per_unit: draft.caloriesPerUnit,
      protein_g_per_unit: draft.proteinGPerUnit,
      sort_order: draft.sortOrder,
    })),
  );

  if (itemsError) {
    // Compensating delete (ai-context/DECISIONS.md "createMealFromEntries atomicity...") — part
    // of this action's contract, not a nice-to-have. supabase-js exposes no cross-statement
    // transaction, so on item-insert failure we clean up the meal row we just created rather than
    // leaving it orphaned. If this delete itself also fails, the residual state is a named, empty,
    // user-deletable meal — knowingly accepted (same decision entry); `logMealForDay` already
    // refuses to log an empty meal, so it cannot propagate anywhere downstream. Its own result is
    // intentionally not awaited-and-checked further — there is nothing more useful to do with a
    // failure here than what's already been decided.
    await supabase.from("meals").delete().eq("id", (meal as Meal).id).eq("user_id", user.id);
    return { ok: false, error: itemsError.message };
  }

  // Nothing above ever issues an UPDATE or DELETE against food_entries — this action is strictly
  // read-only on that table by construction (no such statement exists in this function), which is
  // what makes "the source entries are byte-identical before and after" true regardless of what a
  // future edit here might be tempted to add (see the design doc's §5 risk on this).
  return { ok: true, error: null, meal: meal as Meal };
}

// -------------------------------------------------------------------------------------------
// setMealPinned / duplicateMeal (Phase 8f -- "Saved meals: pinning and duplicating",
// 2026-08-05/08). Both follow this file's established shape: a plain-argument action like
// deleteMeal/reorderMealItems for the toggle, and a useActionState/FormData action shaped exactly
// like createMealFromEntries for the form that prompts for a name -- see design doc §3.3.
// -------------------------------------------------------------------------------------------

export async function setMealPinned(mealId: string, isPinned: boolean): Promise<MealsActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "unauthenticated" };
  }

  // `.eq("user_id", user.id)` is belt-and-suspenders on top of RLS (`meals_update_own` already
  // constrains this update, on both `using` and `with check`, to rows the caller owns -- see the
  // Phase 8f migration comment / design doc §3.2) -- same posture as every other mutation here.
  const { error } = await supabase
    .from("meals")
    .update({ is_pinned: isPinned })
    .eq("id", mealId)
    .eq("user_id", user.id);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, error: null };
}

export async function duplicateMeal(
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

  const mealId = String(formData.get("mealId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const validation = validateMealInput({ name });
  if (!validation.ok) {
    const fieldErrors: Partial<Record<MealField, string>> = {};
    for (const e of validation.errors) fieldErrors[e.field] = e.message;
    return { ok: false, error: "Please fix the highlighted errors.", fieldErrors };
  }

  // --- Ownership re-read (the exact same pattern as logMealForDay/createMealFromEntries above):
  // resolve the SOURCE meal and its items via the RLS-scoped `supabase` client -- never
  // service-role, never a client-supplied item list. A foreign or nonexistent `mealId` resolves to
  // zero rows here; reuse `meal_not_found` (logMealForDay's code for the identical condition)
  // rather than minting a new one for the same thing (design doc §3.3).
  const { data: sourceMeal, error: mealError } = await supabase
    .from("meals")
    .select("id")
    .eq("id", mealId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (mealError) {
    return { ok: false, error: mealError.message };
  }
  if (!sourceMeal) {
    return { ok: false, error: "meal_not_found" };
  }

  const { data: sourceItems, error: itemsReadError } = await supabase
    .from("meal_items")
    .select("*")
    .eq("meal_id", mealId)
    .eq("user_id", user.id)
    .order("sort_order", { ascending: true });

  if (itemsReadError) {
    return { ok: false, error: itemsReadError.message };
  }

  // `is_pinned` is deliberately NOT copied -- the duplicate always starts unpinned (design doc
  // §3.2/§3.3/§5): pinning describes the user's current shortlist, not the meal's content, and a
  // duplicate exists to be edited into something else.
  const { data: newMeal, error: createError } = await supabase
    .from("meals")
    .insert({ user_id: user.id, name })
    .select()
    .single();

  if (createError || !newMeal) {
    return { ok: false, error: createError?.message ?? "Couldn't create the meal." };
  }

  const items = (sourceItems ?? []) as MealItem[];
  // An empty source meal (zero items) duplicates successfully into an empty meal -- deliberately
  // NOT rejected the way createMealFromEntries rejects `no_entries` (design doc §3.3): an empty
  // meal is a state `createMeal` itself already produces, so refusing to duplicate one would be an
  // arbitrary asymmetry. `logMealForDay` still refuses to log it (`empty_meal`).
  if (items.length > 0) {
    // sort_order is PRESERVED from the source item, NOT renumbered 0..N-1 -- this is the one place
    // a developer is most likely to reach for the wrong helper (`mealItemsFromEntries` assigns
    // fresh order because food entries have no order of their own; a saved meal already has a
    // user-curated one, and reproducing it is the entire point of a duplicate — see design doc
    // §3.3/§5, "Two 'copy a meal by value' paths now exist and must not drift").
    const { error: itemsWriteError } = await supabase.from("meal_items").insert(
      items.map((item) => ({
        meal_id: (newMeal as Meal).id,
        user_id: user.id,
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        calories_per_unit: item.calories_per_unit,
        protein_g_per_unit: item.protein_g_per_unit,
        sort_order: item.sort_order,
      })),
    );

    if (itemsWriteError) {
      // Compensating delete -- the exact same contract as createMealFromEntries's
      // (ai-context/DECISIONS.md "createMealFromEntries atomicity...", reused verbatim here since
      // supabase-js exposes no cross-statement transaction). If this delete itself also fails, the
      // residual state is a named, empty, user-deletable meal -- knowingly accepted, same as above.
      await supabase.from("meals").delete().eq("id", (newMeal as Meal).id).eq("user_id", user.id);
      return { ok: false, error: itemsWriteError.message };
    }
  }

  // Nothing above ever issues an UPDATE or DELETE against the SOURCE meal or its items -- this
  // action is strictly read-only on the source, by there simply being no such statement in this
  // function's code path (design doc §3.3/§5, same reasoning as createMealFromEntries's
  // read-only-on-food_entries guarantee).
  return { ok: true, error: null, meal: newMeal as Meal };
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
      state: { ok: false, error: "Please fix the highlighted errors.", fieldErrors },
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
    return { ok: false, error: "Please fix the highlighted errors.", fieldErrors };
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

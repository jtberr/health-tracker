"use server";

import { createClient } from "@/lib/supabase/server";
import {
  isValidTimeZone,
  localDateNotAfterToday,
  localInputToUtcInTz,
  utcToLocalTime,
} from "@/lib/domain/datetime";
import { perUnitFromTotal } from "@/lib/domain/quantity";
import {
  validateCopyFoodEntriesInput,
  validateFoodEntryInput,
  type FoodEntryField,
} from "@/lib/domain/validation";
import type { FoodEntry } from "@/lib/types";

/**
 * Server Actions for food entries (Phase 3 — "Core food logging loop"), following the same
 * shape Phase 1's auth actions established (see `lib/actions/auth.ts`): a typed `*ActionState`
 * consumed via React's `useActionState`, `FormData` in, `user_id` only ever from the
 * authenticated server-side session (never client input — AGENTS.md Absolute Rules).
 *
 * Input-mode handling (§4 "Quantity + unit as first-class fields"): the form submits a `mode`
 * field ("perUnit" | "total"). In "total" mode the submitted calories/protein values are a total
 * for the current quantity and are converted to per-unit here via `quantity.perUnitFromTotal`
 * before the single-model insert/update — so there is exactly one storage shape regardless of
 * which mode produced it, and a later quantity edit always recomputes correctly (the DB's
 * generated `calories`/`protein_g` columns do that recompute).
 *
 * No-future-day cap (ai-context/DECISIONS.md "No logging into the future ..."): checked
 * up-front here via `datetime.localDateNotAfterToday`, returning the typed `error: 'future_date'`
 * before any DB write is attempted; the DB's own `food_entries_not_future_day` CHECK is the
 * backstop.
 */

export type FoodEntryActionState = {
  ok: boolean;
  error: string | null;
  fieldErrors?: Partial<Record<FoodEntryField, string>>;
  entry?: FoodEntry;
};

export type DeleteFoodEntryResult = { ok: boolean; error: string | null };

type ParsedFoodEntryForm =
  | { ok: true; value: FoodEntryWritePayload }
  | { ok: false; state: FoodEntryActionState };

type FoodEntryWritePayload = {
  name: string;
  quantity: number;
  unit: string | null;
  caloriesPerUnit: number;
  proteinGPerUnit: number;
  consumedAt: string;
  consumedTz: string;
};

export async function addFoodEntry(
  _prevState: FoodEntryActionState,
  formData: FormData,
): Promise<FoodEntryActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "unauthenticated" };
  }

  const parsed = parseAndValidateFoodEntryForm(formData);
  if (!parsed.ok) return parsed.state;

  const { data, error } = await supabase
    .from("food_entries")
    .insert({
      user_id: user.id,
      name: parsed.value.name,
      quantity: parsed.value.quantity,
      unit: parsed.value.unit,
      calories_per_unit: parsed.value.caloriesPerUnit,
      protein_g_per_unit: parsed.value.proteinGPerUnit,
      consumed_at: parsed.value.consumedAt,
      consumed_tz: parsed.value.consumedTz,
    })
    .select()
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, error: null, entry: data as FoodEntry };
}

export async function updateFoodEntry(
  _prevState: FoodEntryActionState,
  formData: FormData,
): Promise<FoodEntryActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "unauthenticated" };
  }

  const id = String(formData.get("id") ?? "");
  if (!id) {
    return { ok: false, error: "Missing entry id." };
  }

  const parsed = parseAndValidateFoodEntryForm(formData);
  if (!parsed.ok) return parsed.state;

  // `.eq("user_id", user.id)` is belt-and-suspenders alongside RLS (the policy already scopes
  // the update to the caller's own rows) — makes the ownership intent explicit at the call site.
  const { data, error } = await supabase
    .from("food_entries")
    .update({
      name: parsed.value.name,
      quantity: parsed.value.quantity,
      unit: parsed.value.unit,
      calories_per_unit: parsed.value.caloriesPerUnit,
      protein_g_per_unit: parsed.value.proteinGPerUnit,
      consumed_at: parsed.value.consumedAt,
      consumed_tz: parsed.value.consumedTz,
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, error: null, entry: data as FoodEntry };
}

// -------------------------------------------------------------------------------------------
// copyFoodEntries — the shared copy/repeat primitive (Phase 8 — "Ease-of-entry extras").
// Three thin callers all funnel through this one action (ai-context/DECISIONS.md "Copy/repeat
// entries via one shared `copyFoodEntries` primitive..."): (a) `CopyDayDialog` passes every id
// from the currently-viewed day; (b) per-entry "Log again" passes a single id with
// `toDate=today`/an explicit `toTime` (the floor-of-now grid value); (c) "Copy this group" (a
// `FoodEntryList` group header action) passes an exact-`consumed_at` group's ids. See design doc
// §3.3 for the full contract.
// -------------------------------------------------------------------------------------------

export type CopyFoodEntriesInput = {
  entryIds: string[];
  toDate: string;
  /** Omit to preserve each source entry's own local time-of-day on `toDate` (see below). */
  toTime?: string;
  toTz: string;
};

export type CopyFoodEntriesResult = {
  ok: boolean;
  error: string | null;
  entries?: FoodEntry[];
};

/**
 * Duplicates `entryIds` (which must ALL belong to the caller) into new `food_entries` rows dated
 * `toDate` in `toTz`. `logged_from_meal_id` is never carried over — a copy is a fresh manual log,
 * not a meal-logging event (ai-context/DECISIONS.md) — so every inserted row gets the column's
 * default (`null`), simply by never setting it.
 *
 * Goes through the exact same no-future-day validation as any other write
 * (`localDateNotAfterToday`) — copying cannot be used to route around the cap — and the exact same
 * ownership re-check pattern `createMealFromEntries` (Phase 7b) already established: the source
 * rows are re-read via the RLS-scoped client (never service-role, never trusting client-supplied
 * values), and a foreign id / nonexistent id / mixed own-and-foreign set all collapse to the same
 * whole-request rejection rather than silently copying a partial subset.
 */
export async function copyFoodEntries(input: CopyFoodEntriesInput): Promise<CopyFoodEntriesResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "unauthenticated" };
  }

  // Dedupe + drop blanks — defensive, mirrors `createMealFromEntries`'s identical guard.
  const entryIds = Array.from(new Set(input.entryIds.filter((id) => id.length > 0)));
  const toTime = input.toTime && input.toTime.length > 0 ? input.toTime : undefined;
  const toTz = input.toTz.trim();

  const validation = validateCopyFoodEntriesInput({ entryIds, toDate: input.toDate, toTime });
  if (!validation.ok) {
    // An empty selection is the one case worth a stable short code (matching
    // `createMealFromEntries`'s `no_entries` convention) — every Phase 8 caller only ever supplies
    // a real date/an already-gridded time from its own UI, so a bad `toDate`/`toTime` shape here
    // would be a caller bug, not a real user-facing state; fall back to the first message.
    if (validation.errors.some((e) => e.field === "entryIds")) {
      return { ok: false, error: "no_entries" };
    }
    return { ok: false, error: validation.errors[0].message };
  }

  if (!toTz) {
    return { ok: false, error: "Missing time zone." };
  }

  // Same defensive check as this file's other tz-taking actions — a garbled/tampered `toTz` must
  // fail gracefully here, BEFORE it ever reaches `localDateNotAfterToday`/`localInputToUtcInTz`,
  // both of which throw a `RangeError` on an invalid IANA zone (see `isValidTimeZone`'s doc comment).
  if (!isValidTimeZone(toTz)) {
    return { ok: false, error: "invalid_timezone" };
  }

  // No-future-day cap on the whole batch, checked up front, before any read/insert — exactly like
  // `addFoodEntry`/`updateFoodEntry`/`logMealForDay`. Copying cannot be used to bypass the cap.
  if (!localDateNotAfterToday(input.toDate, toTz)) {
    return { ok: false, error: "future_date" };
  }

  // Ownership re-check (same pattern as `createMealFromEntries`): resolve the SOURCE entries via
  // the RLS-scoped client already bound to this session's `supabase` client — never service-role,
  // never any client-supplied name/calorie values. A foreign id, a nonexistent id, or a mixed
  // own/foreign set all collapse to "fewer rows came back than ids were requested" — reject the
  // WHOLE request rather than silently copying a partial subset, which would look like it worked.
  const { data: rows, error: entriesError } = await supabase
    .from("food_entries")
    .select("*")
    .in("id", entryIds)
    .eq("user_id", user.id);

  if (entriesError) {
    return { ok: false, error: entriesError.message };
  }
  if (!rows || rows.length !== entryIds.length) {
    return { ok: false, error: "entries_not_found" };
  }

  const sourceEntries = rows as FoodEntry[];

  // If `toTime` is omitted, each copy preserves ITS OWN source local time-of-day on `toDate` — so
  // a copied group (whose sources all share one exact `consumed_at`) lands on one new instant and
  // stays grouped (design doc §3.3). If `toTime` IS supplied (the "Log again" case), every copied
  // row uses that one explicit time instead.
  const newRows = sourceEntries.map((entry) => {
    const timeOfDay = toTime ?? utcToLocalTime(entry.consumed_at, entry.consumed_tz).time;
    return {
      user_id: user.id,
      name: entry.name,
      quantity: entry.quantity,
      unit: entry.unit,
      calories_per_unit: entry.calories_per_unit,
      protein_g_per_unit: entry.protein_g_per_unit,
      consumed_at: localInputToUtcInTz(input.toDate, timeOfDay, toTz),
      consumed_tz: toTz,
      // logged_from_meal_id deliberately omitted (defaults to null, its column default) — a copy
      // is a fresh manual log, not a meal-logging event.
    };
  });

  // A single multi-row INSERT is one Postgres statement — it either inserts every row or none
  // (atomic per-statement), which is what "future-cap rejection / cross-user rejection writes zero
  // rows" both rely on; there is no insert call before this point.
  const { data: inserted, error: insertError } = await supabase
    .from("food_entries")
    .insert(newRows)
    .select();

  if (insertError) {
    return { ok: false, error: insertError.message };
  }

  return { ok: true, error: null, entries: (inserted ?? []) as FoodEntry[] };
}

export async function deleteFoodEntry(id: string): Promise<DeleteFoodEntryResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "unauthenticated" };
  }

  const { error } = await supabase.from("food_entries").delete().eq("id", id).eq("user_id", user.id);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, error: null };
}

function parseAndValidateFoodEntryForm(formData: FormData): ParsedFoodEntryForm {
  const name = String(formData.get("name") ?? "");
  const quantityRaw = String(formData.get("quantity") ?? "").trim();
  const quantity = quantityRaw === "" ? 1 : Number(quantityRaw);
  const unitRaw = String(formData.get("unit") ?? "").trim();
  const unit = unitRaw === "" ? null : unitRaw;
  const mode = String(formData.get("mode") ?? "total") === "perUnit" ? "perUnit" : "total";
  const caloriesInput = Number(formData.get("calories"));
  const proteinInput = Number(formData.get("protein"));
  const consumedDate = String(formData.get("consumedDate") ?? "");
  const consumedTime = String(formData.get("consumedTime") ?? "");
  const consumedTz = String(formData.get("consumedTz") ?? "").trim();

  // The two input modes (§4): "total" means the submitted calories/protein are a total for the
  // current quantity and get converted to per-unit here; "perUnit" means they're already
  // per-unit. Either way there is exactly one thing validated/stored below.
  const caloriesPerUnit = mode === "perUnit" ? caloriesInput : perUnitFromTotal(caloriesInput, quantity);
  const proteinGPerUnit = mode === "perUnit" ? proteinInput : perUnitFromTotal(proteinInput, quantity);

  const validation = validateFoodEntryInput({
    name,
    quantity,
    caloriesPerUnit,
    proteinGPerUnit,
    consumedDate,
    consumedTime,
  });

  if (!validation.ok) {
    const fieldErrors: Partial<Record<FoodEntryField, string>> = {};
    for (const e of validation.errors) fieldErrors[e.field] = e.message;
    return {
      ok: false,
      state: { ok: false, error: "Please fix the highlighted errors.", fieldErrors },
    };
  }

  if (!consumedTz) {
    return {
      ok: false,
      state: { ok: false, error: "Missing time zone." },
    };
  }

  // A tampered/garbled tz (e.g. a hostile client overwriting the hidden consumedTz field) must
  // fail gracefully here, BEFORE it ever reaches localDateNotAfterToday/localInputToUtcInTz —
  // both call through to Intl.DateTimeFormat internally, which throws a RangeError on an invalid
  // timeZone. Left unchecked, that throw propagates out of this Server Action uncaught, surfacing
  // a generic Next.js error page instead of the graceful field-level error every other validation
  // failure in this module already returns.
  if (!isValidTimeZone(consumedTz)) {
    return {
      ok: false,
      state: { ok: false, error: "invalid_timezone" },
    };
  }

  if (!localDateNotAfterToday(consumedDate, consumedTz)) {
    return { ok: false, state: { ok: false, error: "future_date" } };
  }

  const consumedAt = localInputToUtcInTz(consumedDate, consumedTime, consumedTz);

  return {
    ok: true,
    value: {
      name: name.trim(),
      quantity,
      unit,
      caloriesPerUnit,
      proteinGPerUnit,
      consumedAt,
      consumedTz,
    },
  };
}

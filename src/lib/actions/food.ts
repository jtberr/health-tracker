"use server";

import { createClient } from "@/lib/supabase/server";
import { localDateNotAfterToday, localInputToUtcInTz } from "@/lib/domain/datetime";
import { perUnitFromTotal } from "@/lib/domain/quantity";
import { validateFoodEntryInput, type FoodEntryField } from "@/lib/domain/validation";
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
      state: { ok: false, error: "Please fix the errors below.", fieldErrors },
    };
  }

  if (!consumedTz) {
    return {
      ok: false,
      state: { ok: false, error: "Missing time zone." },
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

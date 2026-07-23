"use server";

import { createClient } from "@/lib/supabase/server";
import { localDateNotAfterToday } from "@/lib/domain/datetime";
import { weightToKg } from "@/lib/domain/units";
import { validateDailyMetricInput, type DailyMetricField } from "@/lib/domain/validation";
import type { DailyMetric, WeightUnit } from "@/lib/types";

/**
 * Server Actions for `daily_metrics` (Phase 4 — "Weight/body-fat logging + goals/settings"),
 * mirroring `lib/actions/food.ts`'s shape exactly: a typed `*ActionState` consumed via
 * `useActionState`, `FormData` in, `user_id` only ever from the authenticated server-side
 * session (never client input — AGENTS.md Absolute Rules).
 *
 * One row per `(user_id, metric_date)` (DB `unique` constraint) — a write for an existing date is
 * an upsert/overwrite, not a new row, so `upsertDailyMetric` covers both "log today's weight for
 * the first time" and "correct today's already-logged weight".
 *
 * No-future-day cap (ai-context/DECISIONS.md "No logging into the future ..."): `daily_metrics`
 * has no per-row timezone column (unlike `food_entries`), so its DB CHECK
 * (`metric_date <= current_date + 1`) is deliberately loose. Precise same-day enforcement happens
 * here via the client-supplied `metricTz` (the user's IANA zone) and the same
 * `datetime.localDateNotAfterToday` helper food entries use — returning `error: 'future_date'`
 * before any DB write, exactly like `food.ts`.
 */

export type DailyMetricActionState = {
  ok: boolean;
  error: string | null;
  fieldErrors?: Partial<Record<DailyMetricField, string>>;
  metric?: DailyMetric;
};

export type DeleteDailyMetricResult = { ok: boolean; error: string | null };

export async function upsertDailyMetric(
  _prevState: DailyMetricActionState,
  formData: FormData,
): Promise<DailyMetricActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "unauthenticated" };
  }

  const metricDate = String(formData.get("metricDate") ?? "");
  const metricTz = String(formData.get("metricTz") ?? "").trim();
  const weightUnit: WeightUnit = String(formData.get("weightUnit") ?? "kg") === "lb" ? "lb" : "kg";
  const weightRaw = String(formData.get("weight") ?? "").trim();
  const weight = weightRaw === "" ? NaN : Number(weightRaw);
  const bodyFatRaw = String(formData.get("bodyFatPct") ?? "").trim();
  const bodyFatPct = bodyFatRaw === "" ? null : Number(bodyFatRaw);

  const validation = validateDailyMetricInput({ metricDate, weight, bodyFatPct });
  if (!validation.ok) {
    const fieldErrors: Partial<Record<DailyMetricField, string>> = {};
    for (const e of validation.errors) fieldErrors[e.field] = e.message;
    return { ok: false, error: "Please fix the errors below.", fieldErrors };
  }

  if (!metricTz) {
    return { ok: false, error: "Missing time zone." };
  }

  if (!localDateNotAfterToday(metricDate, metricTz)) {
    return { ok: false, error: "future_date" };
  }

  const weightKg = weightToKg(weight, weightUnit);

  const { data, error } = await supabase
    .from("daily_metrics")
    .upsert(
      { user_id: user.id, metric_date: metricDate, weight_kg: weightKg, body_fat_pct: bodyFatPct },
      { onConflict: "user_id,metric_date" },
    )
    .select()
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, error: null, metric: data as DailyMetric };
}

export async function deleteDailyMetric(id: string): Promise<DeleteDailyMetricResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "unauthenticated" };
  }

  // `.eq("user_id", user.id)` is belt-and-suspenders alongside RLS, same convention as
  // `deleteFoodEntry` in `lib/actions/food.ts`.
  const { error } = await supabase.from("daily_metrics").delete().eq("id", id).eq("user_id", user.id);

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, error: null };
}

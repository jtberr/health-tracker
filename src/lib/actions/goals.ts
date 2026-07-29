"use server";

import { createClient } from "@/lib/supabase/server";
import { validateGoalsInput, type GoalsField } from "@/lib/domain/validation";
import type { UserGoals, WeightUnit } from "@/lib/types";

/**
 * Server Actions for `user_goals` (Phase 4 — "Weight/body-fat logging + goals/settings"). One row
 * per user (`user_id` is the PK); `getGoals` implements the "ensure-row" access pattern the design
 * doc calls for (docs/architecture/food-weight-tracker.md §8 Phase 4): a user's first visit to
 * Settings has no row yet, so this creates the default (`weight_unit: 'kg'`, null targets) rather
 * than treating a missing row as an error.
 *
 * `user_id` is always resolved from the authenticated server-side session, never client input,
 * matching every other action in this codebase (AGENTS.md Absolute Rules).
 */

export type GoalsActionState = {
  ok: boolean;
  error: string | null;
  fieldErrors?: Partial<Record<GoalsField, string>>;
  goals?: UserGoals;
};

export async function getGoals(): Promise<UserGoals | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return null;
  }

  const { data: existing } = await supabase
    .from("user_goals")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  if (existing) {
    return existing as UserGoals;
  }

  // First visit: no row yet — create the default rather than surfacing "not found" to the caller.
  // An upsert (not a plain insert) so two concurrent first-visit requests for the same user (e.g.
  // two tabs) can't race into a unique-violation error — the loser's conflicting write just becomes
  // a harmless no-op update instead (only `user_id` is set on conflict, so it never clobbers an
  // already-customized row). `.select().single()` reads the row back from this same call rather
  // than issuing a second, separate `select` — that second query would have the exact same shape
  // as the `existing` check above, and Next.js's fetch request memoization dedupes identical
  // requests within one render pass, which would silently serve the pre-insert (empty) result.
  const { data: created, error } = await supabase
    .from("user_goals")
    .upsert({ user_id: user.id }, { onConflict: "user_id" })
    .select()
    .single();

  if (error) {
    return null;
  }

  return created as UserGoals;
}

export async function updateGoals(
  _prevState: GoalsActionState,
  formData: FormData,
): Promise<GoalsActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "unauthenticated" };
  }

  const calorieRaw = String(formData.get("dailyCalorieTarget") ?? "").trim();
  const proteinRaw = String(formData.get("dailyProteinTargetG") ?? "").trim();
  const weightUnit: WeightUnit = String(formData.get("weightUnit") ?? "kg") === "lb" ? "lb" : "kg";

  const dailyCalorieTarget = calorieRaw === "" ? null : Number(calorieRaw);
  const dailyProteinTargetG = proteinRaw === "" ? null : Number(proteinRaw);

  const validation = validateGoalsInput({ dailyCalorieTarget, dailyProteinTargetG });
  if (!validation.ok) {
    const fieldErrors: Partial<Record<GoalsField, string>> = {};
    for (const e of validation.errors) fieldErrors[e.field] = e.message;
    return { ok: false, error: "Please fix the highlighted errors.", fieldErrors };
  }

  // `user_goals` is a "settings row" per user (ensure-row pattern above), so this write is always
  // an upsert keyed on the PK — there is no separate create/update distinction from the caller's
  // point of view.
  const { data, error } = await supabase
    .from("user_goals")
    .upsert(
      {
        user_id: user.id,
        daily_calorie_target: dailyCalorieTarget,
        daily_protein_target_g: dailyProteinTargetG,
        weight_unit: weightUnit,
      },
      { onConflict: "user_id" },
    )
    .select()
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, error: null, goals: data as UserGoals };
}

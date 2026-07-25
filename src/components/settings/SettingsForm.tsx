"use client";

import { useActionState, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { updateGoals, type GoalsActionState } from "@/lib/actions/goals";
import { Button } from "@/components/ui/Button";
import { errorTextClass, inputClass, labelClass } from "@/components/ui/styles";
import type { UserGoals, WeightUnit } from "@/lib/types";

/**
 * Goals + weight-unit preference (design doc §3.1 `settings/SettingsForm.tsx`, §8 Phase 4):
 * a single current daily calorie/protein target (both optional/nullable — "single current goal,
 * not goal history", ai-context/DECISIONS.md) and the kg/lb display preference that
 * `MetricForm`/`lib/domain/units.ts` read at the input/display edge. Storage is always kg
 * regardless of this toggle — changing it here never rewrites any already-stored weight.
 */

const initialActionState: GoalsActionState = { ok: false, error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving..." : "Save settings"}
    </Button>
  );
}

export type SettingsFormProps = {
  initialGoals: UserGoals;
};

export function SettingsForm({ initialGoals }: SettingsFormProps) {
  const [state, formAction] = useActionState(updateGoals, initialActionState);

  // The freshest known-good row: the just-saved row once a save succeeds, otherwise the
  // server-fetched initial row. Keying the fields below on its `updated_at` forces a fresh mount
  // after every successful save — React's form Actions reset the underlying native `<form>` once
  // the action settles, which desyncs a *controlled* radio's visible `checked` state from React's
  // own state (confirmed in the browser: the save itself is correct and survives a reload, but
  // without this the "Weight unit" radio visibly snaps back to its pre-save selection right after
  // clicking Save). Remounting with fresh `defaultChecked`/initial state sidesteps the native reset
  // entirely, the same "reset state via key" pattern `MetricForm` already uses for day-switching.
  const goals = state.ok && state.goals ? state.goals : initialGoals;

  return <SettingsFields key={goals.updated_at} goals={goals} state={state} formAction={formAction} />;
}

function SettingsFields({
  goals,
  state,
  formAction,
}: {
  goals: UserGoals;
  state: GoalsActionState;
  formAction: (formData: FormData) => void;
}) {
  const idPrefix = useId();

  const [dailyCalorieTarget, setDailyCalorieTarget] = useState(() =>
    goals.daily_calorie_target != null ? String(goals.daily_calorie_target) : "",
  );
  const [dailyProteinTargetG, setDailyProteinTargetG] = useState(() =>
    goals.daily_protein_target_g != null ? String(goals.daily_protein_target_g) : "",
  );
  const [weightUnit, setWeightUnit] = useState<WeightUnit>(goals.weight_unit);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-5 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5"
      noValidate
    >
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-calories`} className={labelClass}>
            Daily calorie target (optional)
          </label>
          <input
            id={`${idPrefix}-calories`}
            name="dailyCalorieTarget"
            type="number"
            step={1}
            min={0}
            value={dailyCalorieTarget}
            onChange={(e) => setDailyCalorieTarget(e.target.value)}
            className={inputClass}
          />
          {state.fieldErrors?.dailyCalorieTarget && (
            <p className={errorTextClass}>{state.fieldErrors.dailyCalorieTarget}</p>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idPrefix}-protein`} className={labelClass}>
            Daily protein target, g (optional)
          </label>
          <input
            id={`${idPrefix}-protein`}
            name="dailyProteinTargetG"
            type="number"
            step="any"
            min={0}
            value={dailyProteinTargetG}
            onChange={(e) => setDailyProteinTargetG(e.target.value)}
            className={inputClass}
          />
          {state.fieldErrors?.dailyProteinTargetG && (
            <p className={errorTextClass}>{state.fieldErrors.dailyProteinTargetG}</p>
          )}
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className={labelClass}>Weight unit</legend>
        <div className="inline-flex w-fit rounded-full border border-stone-200 bg-stone-50 p-1">
          <label className="relative cursor-pointer">
            <input
              type="radio"
              name="weightUnit"
              value="kg"
              checked={weightUnit === "kg"}
              onChange={() => setWeightUnit("kg")}
              className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            <span className="block rounded-full px-3 py-1.5 text-sm font-medium text-stone-600 transition-colors peer-checked:bg-white peer-checked:text-sage-deep peer-checked:shadow-sm">
              Kilograms (kg)
            </span>
          </label>
          <label className="relative cursor-pointer">
            <input
              type="radio"
              name="weightUnit"
              value="lb"
              checked={weightUnit === "lb"}
              onChange={() => setWeightUnit("lb")}
              className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            <span className="block rounded-full px-3 py-1.5 text-sm font-medium text-stone-600 transition-colors peer-checked:bg-white peer-checked:text-sage-deep peer-checked:shadow-sm">
              Pounds (lb)
            </span>
          </label>
        </div>
        <p className="text-xs text-stone-500">
          Weight is always stored in kilograms — this only changes how it&apos;s entered/displayed.
        </p>
      </fieldset>

      {state.error && <p className={errorTextClass}>{state.error}</p>}
      {state.ok && (
        <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-sage-pale px-3 py-1 text-xs font-medium text-ink">
          Settings saved.
        </p>
      )}

      <div>
        <SubmitButton />
      </div>
    </form>
  );
}

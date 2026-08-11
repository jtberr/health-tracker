import type { Metadata } from "next";
import { getGoals } from "@/lib/actions/goals";
import { SettingsForm } from "@/components/settings/SettingsForm";

export const metadata: Metadata = { title: "Settings — Health Tracker" };

/**
 * Goals + weight-unit preference (design doc §3.1/§8 Phase 4). `getGoals` is the "ensure-row"
 * read — a user's first visit creates the default `user_goals` row rather than erroring, so this
 * should always resolve for an authenticated user (the `(app)/layout.tsx` auth gate already
 * guarantees one); the `null` branch below is a defensive fallback for an unexpected DB error, not
 * the expected "no row yet" case.
 */
export default async function SettingsPage() {
  const goals = await getGoals();

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Settings</h1>
      {goals ? (
        <SettingsForm initialGoals={goals} />
      ) : (
        <p className="text-sm text-red-600">
          Couldn&apos;t load your settings right now. Please refresh and try again.
        </p>
      )}
    </div>
  );
}

import type { Metadata } from "next";
import { MealsView } from "@/components/meals/MealsView";

export const metadata: Metadata = { title: "Saved meals — Health Tracker" };

/**
 * Saved-meals library (design doc §3.1/§8 Phase 7): create/rename/delete meals and add/edit/
 * remove/reorder their items. CRUD only — logging a saved meal happens on `/food` via
 * `LogMealDialog`, not here (see the design doc's module tree: "meals/page.tsx ← Saved-meals
 * library CRUD"). All the interactive/fetch/refetch logic lives in the client `MealsView` — see
 * its doc comment for why reads happen there rather than in this Server Component.
 */
export default function MealsPage() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">Saved meals</h1>
      <MealsView />
    </div>
  );
}

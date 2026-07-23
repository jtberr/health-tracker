import type { Metadata } from "next";
import { FoodDayView } from "@/components/food/FoodDayView";

export const metadata: Metadata = { title: "Food log — Health Tracker" };

/**
 * Food log for a selected day (design doc §3.1/§8 Phase 3): add/edit/delete entries, grouped by
 * exact-`consumed_at` meal group, with day totals. All the interactive/day-switching/smart-default
 * logic lives in the client `FoodDayView` — see its doc comment for why reads happen there rather
 * than in this Server Component.
 */
export default function FoodPage() {
  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Food log</h1>
      <FoodDayView />
    </div>
  );
}

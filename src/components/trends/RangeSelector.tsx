"use client";

import Link from "next/link";
import { TREND_RANGES, type TrendRange } from "@/lib/domain/trends";

/**
 * 7/30/90-day range toggle (design doc §3.1/§8 Phase 5). The URL's `?range=` query param is the
 * source of truth — not local component state — matching how `NavLink` derives its active state
 * from `usePathname()` rather than an internal store: each pill is a plain `Link` to
 * `/trends?range=<n>`, so navigating updates the URL, which `trends/page.tsx` (a Server Component)
 * re-reads and passes back down as the `range` prop. No `useState`/`useRouter` needed here.
 */
export function RangeSelector({ range }: { range: TrendRange }) {
  return (
    <div className="inline-flex w-fit items-center gap-1 rounded-full border border-line bg-white p-1 shadow-sm">
      {TREND_RANGES.map((option) => {
        const isActive = option === range;
        return (
          <Link
            key={option}
            href={`/trends?range=${option}`}
            aria-current={isActive ? "page" : undefined}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
              isActive ? "bg-accent-soft text-ink" : "text-muted hover:bg-slate-100 hover:text-ink"
            }`}
          >
            {option}d
          </Link>
        );
      })}
    </div>
  );
}

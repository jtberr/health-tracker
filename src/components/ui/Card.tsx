import type { HTMLAttributes } from "react";

/**
 * Shared card surface (rounded, bordered, subtle shadow) used for forms, stat rows, and lists.
 *
 * NB-2 fix (qa-reviewer, 2026-07-26): border-stone-200 (#e7e5e4) measured 1.26:1 on white (needs
 * 3:1 for the WCAG 1.4.11 non-text/UI-component threshold). stone-500 (#78716c) is the nearest
 * step up in the same warm-neutral family that clears it: 4.80:1 on white — see
 * ai-context/DECISIONS.md for the full before/after math.
 */
export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`rounded-2xl border border-stone-500 bg-white shadow-sm ${className}`} />;
}

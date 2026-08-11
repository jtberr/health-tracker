/**
 * Inline SVG glyphs (2026-08-05 addition, Phase 8d) — design doc §3.4 "Per-row action density on
 * `/food`" / `ai-context/DECISIONS.md` "Icon buttons **with** tooltips...". Geometry is taken from
 * **Lucide** (https://lucide.dev), ISC licence — copying the path data with attribution here is
 * permitted:
 *
 * ISC License
 * Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather
 * (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.
 *
 * Deliberately NOT an icon-library dependency: four glyphs don't justify one, matching
 * `StatusMessage`'s own precedent of an inline check icon. The recorded threshold for revisiting
 * Lucide-as-a-dependency is roughly 8-10 distinct glyphs (see the design doc / DECISIONS).
 *
 * Every glyph is `aria-hidden="true"` `focusable="false"` — the glyph is always decorative, and a
 * control's accessible name always comes from its own visible text, never from these (WCAG 2.5.3
 * Label in Name; see `Tooltip.tsx` and `FoodEntryList.tsx`/`FoodEntryForm.tsx`'s icon+label
 * buttons). `stroke="currentColor"` so each glyph inherits its `Button` variant's own colour
 * (including the `danger` red and every disabled state) rather than a hardcoded hex — the same
 * `currentColor` technique the trend charts already use (`WeightChart.tsx`/`IntakeChart.tsx`).
 */

export type IconProps = {
  className?: string;
};

const BASE_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none" as const,
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": "true" as const,
  focusable: "false" as const,
};

/** "Log again" (rotate-ccw). */
export function RepeatIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  );
}

/** "Edit" (pencil). */
export function PencilIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.986L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

/** "Delete entry" (trash-2). */
export function TrashIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M10 11v6" />
      <path d="M14 11v6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

/** The `/meals` pin toggle (Phase 8f, `MealList.tsx`) — the app's one deliberate icon-only control
 * with no visible-text equivalent (its state is carried in text by the "Pinned" pill instead). */
export function PinIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="M12 17v5" />
      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
    </svg>
  );
}

/** Expand/collapse toggle (2026-08-10, `MealList.tsx`) — a single glyph, rotated 180° via the
 * caller's own `className` (`rotate-180` when expanded) rather than two separate up/down icons,
 * the standard accordion-chevron convention. Pairs with `aria-expanded` on the button, not a
 * visible label — the caller's `aria-label` carries the accessible name. */
export function ChevronDownIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg {...BASE_PROPS} className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

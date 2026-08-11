"use client";

import { Button } from "@/components/ui/Button";
import { ChevronDownIcon } from "@/components/ui/icons";

export type DisclosureButtonProps = {
  /** The SAME string in both the open and closed states — a rotating chevron (not swapped text)
   * carries the open/closed distinction, so the trigger reads as one persistent control rather
   * than two different labels trading places (design doc §3.4: "the trigger stays rendered while
   * open"). */
  label: string;
  open: boolean;
  onToggle: () => void;
  /** The id of the element this control reveals/hides — wired via `aria-controls`. */
  controls: string;
  className?: string;
};

/**
 * The standard "reveal optional detail" toggle (design doc §3.1 `ui/DisclosureButton.tsx`; Phase
 * 8k, finding 1) — real button chrome (`Button variant="secondary" size="sm"`) plus a rotating
 * `ChevronDownIcon` plus `aria-expanded`/`aria-controls`, replacing a bare accent-text link that
 * read as a hyperlink rather than something clickable, and that announced nothing at all to
 * assistive tech (no `aria-expanded`, so it didn't even read as a disclosure to a screen reader).
 *
 * **A button, not a tab — the deciding argument is structural, not just semantic.**
 * `FoodLookupPanel` already contains a real `role="tablist"` (Search/Barcode); making its own
 * trigger a tab too would nest a tab inside a tab strip — one tab layer switching the other on,
 * genuinely confusing rather than merely unconventional. Disclosure (reveal optional extra tooling
 * on the same form) is the correct semantic for both this and "Add detail" — they are the same
 * control doing the same job a few inches apart on `FoodEntryForm`, so both use this one
 * implementation rather than leaving the form with two idioms for one concept.
 *
 * No new glyph, no icon-library dependency: reuses the exact `ChevronDownIcon` `MealList.tsx`
 * already introduced for its own expand/collapse toggle (2026-08-10) — the recorded ~8-10-glyph
 * threshold for revisiting Lucide-as-a-dependency is unchanged by this addition.
 *
 * **The trigger stays rendered while its panel is open** (never replaced by a separate dismiss
 * control) — clicking it again is the one way to close what it opened, retiring the kind of
 * duplicate-dismissal-control ambiguity already fixed elsewhere in this app (the group-header
 * toggle's "Cancel" → "Close" rename).
 */
export function DisclosureButton({ label, open, onToggle, controls, className = "" }: DisclosureButtonProps) {
  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      onClick={onToggle}
      aria-expanded={open}
      aria-controls={controls}
      className={`inline-flex items-center gap-1.5 self-start ${className}`}
    >
      {label}
      <ChevronDownIcon className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
    </Button>
  );
}

"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

export type ActionPanelProps = {
  /** Names the action awaiting completion (e.g. "Save as meal", "Copy selected"). Rendered as a
   * real visible heading and wired via `aria-labelledby` -- this IS the "where do I look" answer
   * for screen-reader/keyboard users, who get no benefit at all from the ring. */
  heading: string;
  children: ReactNode;
};

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Level 3 of the emphasis ladder (design doc §3.4 "Inline actions awaiting completion get real
 * emphasis"; 2026-08-05 addition, Phase 8d; ring/fill tokens swapped 2026-08-09/10, Phase 8i) — an
 * `accent` ring + `accent-soft` fill + a visible heading, for an inline expander that IS an action
 * awaiting completion (as opposed to level 1, a
 * left accent bar for "this row/section is in a notable state" — the editing row, an active group;
 * or level 2, `StatusMessage`'s bar+fill+icon for a transient message).
 *
 * **Colour is the least important part of the fix.** "The user doesn't know where to look" is most
 * reliably answered by putting the panel where they're looking: on mount, this scrolls itself into
 * view (`block: "nearest"`) and moves focus to its first focusable control — the only part of this
 * that helps keyboard and screen-reader users, since none of them can see a ring.
 *
 * **`role="region"` + `aria-labelledby`, NOT a live region** — the user opened this themselves
 * (clicked the button that reveals it), the same test §3.4 already applies to the editing-row
 * highlight (announce only when the user didn't cause the state change themselves).
 *
 * **A pure presentational wrapper — the N-3 unmount rule still governs.** This component has no
 * "closed" state of its own: the CALLER conditionally renders `<ActionPanel>…</ActionPanel>` only
 * while its own expander is open (exactly as `CopyGroupDialog`/`SaveGroupAsMealDialog`/
 * `CopyDayDialog`'s open body already do), driven ONLY by the user's own open/close toggle — never
 * by `loading`, a fetch nonce, `entries.length`, or the selection. Mounting `ActionPanel` fresh
 * every time is what makes "scroll into view + focus first control" fire exactly once per open,
 * and keeps this component from fighting the refresh-survival requirement Phase 8b established
 * (a wrongly-keyed unmount would silently wipe in-flight state a background refresh must not
 * touch).
 *
 * **Applied to exactly six inline expanders** (design doc §3.4): the two bulk panels
 * (`FoodDayView`'s "Copy selected"/"Save selected as a meal"), the two group panels
 * (`FoodEntryList`'s "Copy this group"/"Save as meal"), `CopyDayDialog`'s open body, and (Phase 8f)
 * `DuplicateMealDialog`. **Deliberately NOT applied to** `FoodEntryForm`, the "Add detail"
 * expander, or `FoodLookupPanel` — those are progressive disclosure of optional detail, not a
 * discrete action awaiting completion; wrapping the page's primary, always-present form would
 * emphasise everything and therefore nothing.
 */
export function ActionPanel({ heading, children }: ActionPanelProps) {
  const headingId = useId();
  const containerRef = useRef<HTMLDivElement>(null);

  // Fires exactly once, at the moment this instance mounts (i.e. the moment its caller opens the
  // expander it wraps -- see the "pure presentational wrapper" doc comment above). No reactive
  // value from props/state is read here, so an empty dependency array is correct as-is, not a
  // suppression of anything the exhaustive-deps rule would otherwise flag.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // qa-review N-7 (Phase 8d): honour prefers-reduced-motion -- "smooth" unconditionally would
    // animate this scroll even for a user who has explicitly asked the OS/browser not to. Checked
    // fresh at the moment this fires (not cached in a ref/state) since it's read exactly once, here.
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    container.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "nearest",
    });
    container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)?.focus();
  }, []);

  return (
    <div
      ref={containerRef}
      role="region"
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-xl border border-accent bg-accent-soft p-4 shadow-sm sm:p-5"
    >
      {/* qa-review N-2 (Phase 8d): a real heading element, not just a <p> wired via
          aria-labelledby -- `aria-labelledby` gives the region an accessible NAME, but a
          screen-reader user browsing by heading (a primary SR navigation mode) can't find a <p>
          at all. Tailwind's preflight resets heading margins, so this carries the same visual
          styling as the previous <p> did -- no restyle needed. */}
      <h3 id={headingId} className="text-sm font-semibold text-ink">
        {heading}
      </h3>
      {children}
    </div>
  );
}

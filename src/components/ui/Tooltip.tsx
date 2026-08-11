"use client";

import { cloneElement, isValidElement, useId, useRef, useState } from "react";
import type { AriaAttributes, KeyboardEvent, ReactElement } from "react";

export type TooltipProps = {
  /** The FULLER explanation, shown on pointer devices only. Must EXPLAIN the trigger, never
   * repeat its visible label -- design doc §3.4 "a tooltip must never be the only place a
   * control's purpose is stated": if it repeats the label it's noise, if it's the sole source it's
   * inaccessible. Here it's strictly supplementary. */
  text: string;
  /** A single interactive element (e.g. a `<Button>`). This component clones it to add
   * `aria-describedby` pointing at the tooltip -- the child's own visible text/label remains its
   * ACCESSIBLE NAME; the tooltip only ever adds a description, never an `aria-label` (WCAG 2.5.3
   * "Label in Name" -- an `aria-label` that differs from visible text breaks voice control). Only
   * wrap a control that already has real visible text of its own. */
  children: ReactElement;
};

const HOVER_DELAY_MS = 300;

/**
 * Supplementary, pointer-devices-only tooltip (2026-08-05 addition, Phase 8d) — design doc §3.4
 * "Per-row action density on `/food`" / `Tooltip` — the concrete spec, and
 * `ai-context/DECISIONS.md`'s "Icon buttons **with** tooltips, reconciled for a touch-first
 * user...". Backs the icon+label "Log again"/"Edit" buttons (`FoodEntryList.tsx`), and will back
 * `MealList`'s equivalent controls plus its pin toggle in Phase 8f.
 *
 * **Never the sole source of a control's meaning.** The trigger's visible text label is what
 * carries the control's purpose on every device, including touch (where this component never
 * visibly appears at all — see below); this tooltip only adds a fuller, supplementary sentence for
 * users who can hover or focus with a keyboard.
 *
 * **No portal, no positioning library** — a plain absolutely-positioned `<div>` inside a
 * `position: relative` wrapping `<span>`. Accepted consequence: near a viewport edge it may clip —
 * on desktop only, on a supplementary affordance (design doc §4).
 *
 * **Trigger events**: `mouseenter`/`mouseleave` (with a short ~300ms delay on enter, so it doesn't
 * flicker while the pointer crosses a row) and `focus`/`blur` (no delay), plus `Escape` to dismiss
 * while focused (WCAG 1.4.13 Content on Hover or Focus: dismissible, hoverable, persistent — the
 * events are attached to the wrapping `<span>`, so moving the pointer from the trigger onto the
 * floating tooltip itself — still a DOM descendant of that span — does not fire `mouseleave`,
 * which is what makes it "hoverable" for free).
 *
 * **It deliberately does not render on touch at all.** The tooltip `<div>` is always present in
 * the DOM once `open` (so `aria-describedby` always resolves to a real element), but visibility is
 * gated by the CSS media query `@media (hover: hover) and (pointer: fine)` in `globals.css`
 * (`.tooltip-panel[data-open="true"]`) — a capability query, NOT user-agent sniffing and NOT a JS
 * `ontouchstart` test (both misclassify hybrid laptops). On a touch device the visible label next
 * to the icon is already carrying the meaning (see `FoodEntryList.tsx`), so a tooltip that flashed
 * on tap would be pure noise arriving too late to help — and on touch there is no pre-activation
 * hover at all (a tap focuses AND activates in the same gesture), so a tooltip has nothing useful
 * to explain before the action already fired.
 *
 * **No animation** — nothing for `prefers-reduced-motion` to handle.
 */
export function Tooltip({ text, children }: TooltipProps) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearHoverTimeout() {
    if (hoverTimeoutRef.current !== null) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  }

  function handleMouseEnter() {
    clearHoverTimeout();
    hoverTimeoutRef.current = setTimeout(() => setOpen(true), HOVER_DELAY_MS);
  }

  function handleMouseLeave() {
    clearHoverTimeout();
    setOpen(false);
  }

  function handleFocus() {
    clearHoverTimeout();
    setOpen(true);
  }

  function handleBlur() {
    clearHoverTimeout();
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key === "Escape" && open) {
      clearHoverTimeout();
      setOpen(false);
    }
  }

  if (!isValidElement(children)) return children;

  // The trigger's accessible NAME stays whatever its own visible text already is -- this only ever
  // adds a DESCRIPTION (`aria-describedby`), never an `aria-label` (see the file doc comment).
  const trigger = cloneElement(children as ReactElement<AriaAttributes>, {
    "aria-describedby": tooltipId,
  });

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
    >
      {trigger}
      <div
        role="tooltip"
        id={tooltipId}
        data-open={open ? "true" : "false"}
        className="tooltip-panel pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-max max-w-[16rem] -translate-x-1/2 rounded-lg bg-ink px-2.5 py-1.5 text-xs font-medium text-white shadow-lg"
      >
        {text}
      </div>
    </span>
  );
}

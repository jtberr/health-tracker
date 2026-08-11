"use client";

import { useEffect, useRef } from "react";

/**
 * The single duration every transient success message in the app uses (2026-07-31 addition,
 * Phase 8b) — up from the previous ad-hoc 4s, so the caller never hand-copies a literal. Reasoning
 * (ai-context/DECISIONS.md, "Phase 8b absorbs three more manual-testing findings..."): ~2s to
 * *notice* the message (it appears outside the user's focus — the actual complaint) plus ~2s to
 * *read* the longest realistic string ("Copied 3 entries to 07/29/2026.") plus margin, while
 * staying under the ~8-10s point where a lingering confirmation starts reading as stuck UI.
 */
export const SUCCESS_MESSAGE_MS = 6000;

export type StatusMessageProps = {
  /** The confirmation text — plain prose, e.g. "Entry added." or `Copied 3 entries to 07/29/2026.` */
  message: string;
  /** When set, this instance dismisses itself after this many ms by calling `onDismiss`. Omit for
   * a message with no timer at all. */
  autoDismissMs?: number;
  onDismiss?: () => void;
};

/**
 * Transient success/confirmation banner — a left-accent block, NOT a pill (2026-07-31 addition,
 * Phase 8b; design doc §3.4 "Transient success feedback"; ai-context/DECISIONS.md "Phase 8b
 * absorbs three more manual-testing findings..."). Jeff's complaint about the old pill treatment:
 * it "blends in, doesn't catch the eye, and disappears" and "pills should be used for statuses,
 * not user messages" — the rule this component exists to apply everywhere a *message* (as opposed
 * to a *status*, like `MetricForm`'s "Already logged..." or `FoodEntryList`'s "From a saved meal",
 * both of which deliberately keep their pill) is shown.
 *
 * This is an explicit, PARTIAL reversal of the 2026-07-25 visual-identity decision on
 * `SettingsForm`'s pill: only the SHAPE changes here — the colour call (sage-pale surface, ink
 * text) stands unchanged.
 *
 * `role="status"` makes this actually announced to assistive tech, which the old pill never was
 * (the same live-region gap already flagged for the `/meals` filter, Phase 7c N-3).
 *
 * Contrast guardrail (2026-07-25 token table; superseded by Phase 8i's token swap, 2026-08-09/10,
 * but the RULE is kept anyway): the old `--sage-deep` on `--sage-pale` was ~4.2:1, under AA for
 * small text, so the accent appeared here ONLY as the left border and the decorative icon. The new
 * `--accent` on `--accent-soft` is ~5.49:1 (clears AA text outright), but the same convention is
 * kept — `--accent` stays border/icon-only, never text — so the emphasis ladder maps mechanically
 * with no component's text colour needing to be re-decided. All real text stays `--ink` on
 * `--accent-soft` (~14.6:1).
 *
 * **The auto-dismiss timer is keyed by this component's own mount, not by the message text.** A
 * caller that wants a repeated identical message to get a full fresh duration (fixing the real,
 * previously-unknown bug in `FoodDayView` — see the DECISIONS entry above — where firing "Entry
 * added." twice in a row silently inherited whatever remained of the first occurrence's timer)
 * should force a fresh mount via a `key` that changes every time the message is (re-)shown — the
 * same "reset state via key" idiom `addFormResetNonce`/`MetricForm`/`SettingsForm` already use in
 * this codebase, rather than this component trying to detect "the same message, shown again"
 * itself.
 *
 * **The timer must survive the parent's OTHER re-renders, not just avoid keying on `message`.**
 * Found by qa-reviewer (2026-08-02): every call site passes `onDismiss` as a fresh inline arrow
 * function on each render, so a naive `useEffect(..., [autoDismissMs, onDismiss])` tears down and
 * reschedules the timeout on *any* unrelated parent re-render (e.g. toggling select mode, ticking a
 * checkbox) — the banner can then outlive its documented 6s window indefinitely as long as
 * something else keeps re-rendering the parent, contradicting the "run once per mount" contract
 * above. Fixed by keeping the latest `onDismiss` in a ref (updated every render, cheap and
 * dependency-free) and scheduling the timeout from an effect that depends only on `autoDismissMs` —
 * a stable value in practice (`SUCCESS_MESSAGE_MS`), so the timer is genuinely mount-scoped.
 */
export function StatusMessage({ message, autoDismissMs, onDismiss }: StatusMessageProps) {
  // Always holds the latest `onDismiss` without making it a dependency of the timer effect below —
  // see the doc comment above for the bug this avoids.
  const onDismissRef = useRef(onDismiss);
  useEffect(() => {
    onDismissRef.current = onDismiss;
  });

  // Deliberately NOT depending on `message` or `onDismiss`: this effect's whole contract is "run
  // once per mount of this component instance" -- the caller is responsible for remounting (via
  // `key`) when a repeated message should get a fresh timer. See the doc comments above. (No lint
  // suppression needed: this effect only schedules a timeout, it never calls setState synchronously
  // in the effect body itself.)
  useEffect(() => {
    if (!autoDismissMs) return undefined;
    const timeout = setTimeout(() => onDismissRef.current?.(), autoDismissMs);
    return () => clearTimeout(timeout);
  }, [autoDismissMs]);

  return (
    <div
      role="status"
      className="flex w-full items-start gap-2 rounded-lg border-l-4 border-l-accent bg-accent-soft px-4 py-3 text-sm text-ink"
    >
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="mt-0.5 h-4 w-4 flex-none text-accent"
      >
        <path
          fillRule="evenodd"
          d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
          clipRule="evenodd"
        />
      </svg>
      <p className="min-w-0 flex-1">{message}</p>
    </div>
  );
}

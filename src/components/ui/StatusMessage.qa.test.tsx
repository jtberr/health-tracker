import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useState } from "react";
import { StatusMessage } from "./StatusMessage";

/**
 * QA-REVIEWER independent unit coverage for `StatusMessage` (Phase 8b), written from design doc
 * §3.4 "Transient success feedback" -- specifically the claim in the component's own doc comment
 * that "the auto-dismiss timer is keyed by this component's own mount, not by the message text",
 * and §6's "auto-dismiss is ~6s".
 *
 * The developer's own StatusMessage.test.tsx asserts the timer with a STABLE `onDismiss`
 * (`vi.fn()` captured once), which is the one shape that could not have exposed the real defect
 * this file originally found: every real call site in this app (`FoodDayView`, `SettingsForm`,
 * `MetricForm`, `MealList`) passes a fresh inline arrow instead, and the timer effect used to
 * depend on that arrow's identity, so it tore down and rescheduled on every unrelated parent
 * re-render. Fixed 2026-08-02 (a `ref`-based effect that depends only on `autoDismissMs`) -- this
 * file's second test now asserts the FIXED behaviour under that same inline-callback shape, rather
 * than pinning the bug.
 */

describe("StatusMessage -- timer stability under parent re-renders", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("dismisses on schedule when onDismiss is referentially stable (the developer-tested shape)", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(
      <StatusMessage message="Entry added." autoDismissMs={1000} onDismiss={onDismiss} />,
    );
    for (let i = 0; i < 9; i++) {
      act(() => {
        vi.advanceTimersByTime(100);
      });
      rerender(<StatusMessage message="Entry added." autoDismissMs={1000} onDismiss={onDismiss} />);
    }
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("an INLINE onDismiss -- what every real call site passes -- still dismisses on schedule despite unrelated parent re-renders (regression guard, fixed 2026-08-02)", () => {
    let dismissed = 0;
    function Parent() {
      // Mirrors the real call sites: `onDismiss={() => setSavedMessage(null)}` is a NEW function
      // identity on every render, and StatusMessage's effect lists `onDismiss` in its deps, so the
      // 6s timeout is torn down and rescheduled on each parent render.
      const [, setTick] = useState(0);
      return (
        <div>
          <button type="button" onClick={() => setTick((t) => t + 1)}>
            re-render
          </button>
          <StatusMessage
            message="Entry added."
            autoDismissMs={1000}
            onDismiss={() => {
              dismissed++;
            }}
          />
        </div>
      );
    }
    const { getByRole } = render(<Parent />);

    // Re-render the parent every 500ms -- comfortably more often than the 1000ms window, exactly
    // as ordinary interaction on /food does (typing does not, but any FoodDayView state change,
    // e.g. ticking a select-mode checkbox, does).
    for (let i = 0; i < 10; i++) {
      act(() => {
        vi.advanceTimersByTime(500);
      });
      act(() => {
        getByRole("button", { name: "re-render" }).click();
      });
    }
    act(() => {
      vi.advanceTimersByTime(500);
    });

    // 5500ms have elapsed against a 1000ms window. Originally pinned as a FINDING: the timer used
    // to restart on every parent re-render, so `dismissed` stayed 0. Fixed in `StatusMessage.tsx`
    // by keeping the latest `onDismiss` in a ref and depending only on `autoDismissMs` in the timer
    // effect -- so the timeout fires once, on schedule, regardless of how many times the parent
    // re-renders in between.
    expect(dismissed).toBe(1);
  });
});

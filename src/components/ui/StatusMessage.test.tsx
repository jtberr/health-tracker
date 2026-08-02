import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { StatusMessage, SUCCESS_MESSAGE_MS } from "./StatusMessage";

/**
 * Covers the two load-bearing properties from design doc §3.4 "Transient success feedback" /
 * ai-context/DECISIONS.md's "Phase 8b absorbs three more manual-testing findings...": (1) it's a
 * genuine `role="status"` banner, not a pill, so it's actually announced to assistive tech; (2) the
 * auto-dismiss timer runs once per MOUNT, not keyed on the message text — a caller that wants a
 * repeated identical message to get a full fresh duration must force a remount via `key` (the same
 * "reset state via key" idiom this codebase already uses elsewhere), which this suite proves
 * actually works.
 */

function Wrapper({ nonce, onDismiss }: { nonce: number; onDismiss: () => void }) {
  return (
    <div>
      <StatusMessage key={nonce} message="Entry added." autoDismissMs={1000} onDismiss={onDismiss} />
    </div>
  );
}

describe("StatusMessage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the message as a role=status banner", () => {
    render(<StatusMessage message="Entry added." />);
    expect(screen.getByRole("status")).toHaveTextContent("Entry added.");
  });

  it("calls onDismiss after autoDismissMs elapses, not before", () => {
    const onDismiss = vi.fn();
    render(<StatusMessage message="Entry added." autoDismissMs={1000} onDismiss={onDismiss} />);

    act(() => {
      vi.advanceTimersByTime(999);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("never dismisses when autoDismissMs is omitted", () => {
    const onDismiss = vi.fn();
    render(<StatusMessage message="Entry added." onDismiss={onDismiss} />);

    act(() => {
      vi.advanceTimersByTime(SUCCESS_MESSAGE_MS * 10);
    });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("never dismisses when onDismiss is omitted (no timer to call it on)", () => {
    expect(() => {
      render(<StatusMessage message="Entry added." autoDismissMs={1000} />);
      act(() => {
        vi.advanceTimersByTime(2000);
      });
    }).not.toThrow();
  });

  it("a fresh mount (forced via a changed `key`) gives a repeated identical message a full new timer", () => {
    const onDismiss = vi.fn();
    const { rerender } = render(<Wrapper nonce={1} onDismiss={onDismiss} />);

    act(() => {
      vi.advanceTimersByTime(800);
    });
    expect(onDismiss).not.toHaveBeenCalled();

    // Bumping the key remounts the child fresh -- simulating FoodDayView's `savedMessageNonce`
    // firing the identical message again. If the timer were keyed on the message TEXT instead of
    // the mount, it would already have ~200ms left (1000 - 800), not a fresh 1000ms.
    rerender(<Wrapper nonce={2} onDismiss={onDismiss} />);

    act(() => {
      vi.advanceTimersByTime(800);
    });
    // Total elapsed since remount is only 800ms -- if the old timer had survived, 800+800=1600ms
    // would already have fired it.
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "./Tooltip";

/**
 * Covers the `Tooltip` spec in design doc §3.4 "Per-row action density on `/food`": it wires
 * `aria-describedby` (never `aria-label`) onto the trigger, opens on hover-after-delay and on
 * focus-with-no-delay, dismisses on `Escape` while focused and on blur/mouseleave, and its text is
 * independent of the trigger's own visible label (the "explains, does not repeat" rule).
 *
 * The CSS media-query gate (`@media (hover: hover) and (pointer: fine)`, `globals.css`) that makes
 * this never actually appear on touch is NOT exercised here — jsdom doesn't evaluate real media
 * queries, and the design doc is explicit that this must be verified as an "observable
 * consequence" via real/emulated touch contexts (§6), which belongs in the e2e/manual-browser
 * layer, not a unit test. This file covers the DOM/ARIA wiring and the open/close state machine.
 */
describe("Tooltip", () => {
  it("wires aria-describedby onto the trigger, pointing at the tooltip's own id -- never aria-label", () => {
    render(
      <Tooltip text="Log this entry again at the current time.">
        <button type="button">Log again</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Log again" });
    const describedBy = trigger.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(trigger).not.toHaveAttribute("aria-label");

    const tooltip = screen.getByText("Log this entry again at the current time.");
    expect(tooltip).toHaveAttribute("role", "tooltip");
    expect(tooltip.id).toBe(describedBy);
  });

  it("the trigger's accessible name stays its own visible text, not the tooltip text", () => {
    render(
      <Tooltip text="Edit this entry's name, amount or time.">
        <button type="button">Edit</button>
      </Tooltip>,
    );
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("the tooltip text differs from the trigger's visible label (explains, does not repeat)", () => {
    render(
      <Tooltip text="Log this entry again at the current time.">
        <button type="button">Log again</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Log again" });
    const tooltip = screen.getByText("Log this entry again at the current time.");
    expect(tooltip.textContent).not.toBe(trigger.textContent);
  });

  it("opens on focus with no delay", () => {
    render(
      <Tooltip text="Explanation">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Trigger" });
    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveAttribute("data-open", "false");

    fireEvent.focus(trigger);
    expect(tooltip).toHaveAttribute("data-open", "true");
  });

  it("closes on blur", () => {
    render(
      <Tooltip text="Explanation">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Trigger" });
    const tooltip = screen.getByRole("tooltip");

    fireEvent.focus(trigger);
    expect(tooltip).toHaveAttribute("data-open", "true");
    fireEvent.blur(trigger);
    expect(tooltip).toHaveAttribute("data-open", "false");
  });

  it("opens on hover after the ~300ms delay, not immediately", () => {
    vi.useFakeTimers();
    try {
      render(
        <Tooltip text="Explanation">
          <button type="button">Trigger</button>
        </Tooltip>,
      );
      const wrapper = screen.getByRole("button", { name: "Trigger" }).parentElement!;
      const tooltip = screen.getByRole("tooltip");

      fireEvent.mouseEnter(wrapper);
      expect(tooltip).toHaveAttribute("data-open", "false");

      act(() => {
        vi.advanceTimersByTime(299);
      });
      expect(tooltip).toHaveAttribute("data-open", "false");

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(tooltip).toHaveAttribute("data-open", "true");
    } finally {
      vi.useRealTimers();
    }
  });

  it("closes immediately on mouseleave, cancelling a pending hover-open", () => {
    vi.useFakeTimers();
    try {
      render(
        <Tooltip text="Explanation">
          <button type="button">Trigger</button>
        </Tooltip>,
      );
      const wrapper = screen.getByRole("button", { name: "Trigger" }).parentElement!;
      const tooltip = screen.getByRole("tooltip");

      fireEvent.mouseEnter(wrapper);
      fireEvent.mouseLeave(wrapper);
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      expect(tooltip).toHaveAttribute("data-open", "false");
    } finally {
      vi.useRealTimers();
    }
  });

  it("dismisses on Escape while focused/open, per WCAG 1.4.13", () => {
    render(
      <Tooltip text="Explanation">
        <button type="button">Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Trigger" });
    const wrapper = trigger.parentElement!;
    const tooltip = screen.getByRole("tooltip");

    fireEvent.focus(trigger);
    expect(tooltip).toHaveAttribute("data-open", "true");

    fireEvent.keyDown(wrapper, { key: "Escape" });
    expect(tooltip).toHaveAttribute("data-open", "false");
  });

  it("does not render at all when the child is not a valid single element (defensive)", () => {
    expect(() => render(<Tooltip text="Explanation">{null as unknown as never}</Tooltip>)).not.toThrow();
  });
});

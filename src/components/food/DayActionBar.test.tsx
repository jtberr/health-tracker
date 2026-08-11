import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DayActionBar } from "./DayActionBar";

/**
 * Covers design doc §3.4 "The day-action row becomes a visually grouped toolbar" (Phase 8k) — the
 * component's own contract: it renders exactly the three triggers (never a panel), "Copy this
 * day"/"Select entries" are conditional on `hasEntries` while "Log a saved meal" is always offered,
 * each fires exactly the callback it's wired to, and the container carries no `role="toolbar"` and
 * no group `aria-label` (design doc §3.4/§4: an unimplemented keyboard contract is worse than no
 * role at all, and a group label would add another accessible-name string to a page with this
 * project's worst locator-collision history for no benefit over three plainly-labelled buttons).
 */
describe("DayActionBar", () => {
  it("always renders 'Log a saved meal', even on an empty day", () => {
    render(
      <DayActionBar hasEntries={false} onOpenLogMeal={vi.fn()} onOpenCopyDay={vi.fn()} onEnterSelectMode={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Log a saved meal" })).toBeInTheDocument();
  });

  it("hides 'Copy this day' and 'Select entries' when the day has no entries", () => {
    render(
      <DayActionBar hasEntries={false} onOpenLogMeal={vi.fn()} onOpenCopyDay={vi.fn()} onEnterSelectMode={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "Copy this day" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Select entries" })).not.toBeInTheDocument();
  });

  it("shows all three triggers once the day has entries", () => {
    render(
      <DayActionBar hasEntries={true} onOpenLogMeal={vi.fn()} onOpenCopyDay={vi.fn()} onEnterSelectMode={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: "Log a saved meal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy this day" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select entries" })).toBeInTheDocument();
  });

  it("fires exactly the callback wired to each trigger", () => {
    const onOpenLogMeal = vi.fn();
    const onOpenCopyDay = vi.fn();
    const onEnterSelectMode = vi.fn();
    render(
      <DayActionBar
        hasEntries={true}
        onOpenLogMeal={onOpenLogMeal}
        onOpenCopyDay={onOpenCopyDay}
        onEnterSelectMode={onEnterSelectMode}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Log a saved meal" }));
    expect(onOpenLogMeal).toHaveBeenCalledTimes(1);
    expect(onOpenCopyDay).not.toHaveBeenCalled();
    expect(onEnterSelectMode).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Copy this day" }));
    expect(onOpenCopyDay).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Select entries" }));
    expect(onEnterSelectMode).toHaveBeenCalledTimes(1);
  });

  it("carries no role=toolbar and no group aria-label -- a purely visual grouping", () => {
    const { container } = render(
      <DayActionBar hasEntries={true} onOpenLogMeal={vi.fn()} onOpenCopyDay={vi.fn()} onEnterSelectMode={vi.fn()} />,
    );
    expect(container.querySelector('[role="toolbar"]')).toBeNull();
    expect(container.querySelector("[aria-label]")).toBeNull();
  });

  it("each trigger carries a supplementary tooltip whose text differs from its own label", () => {
    render(
      <DayActionBar hasEntries={true} onOpenLogMeal={vi.fn()} onOpenCopyDay={vi.fn()} onEnterSelectMode={vi.fn()} />,
    );
    const selectEntries = screen.getByRole("button", { name: "Select entries" });
    const describedBy = selectEntries.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    const tooltip = document.getElementById(describedBy!);
    expect(tooltip).not.toBeNull();
    expect(tooltip!.textContent).not.toBe("Select entries");
    // The tooltip is the actual answer to "what does this act on" -- it names the target.
    expect(tooltip!.textContent).toMatch(/day's log below/);
  });
});

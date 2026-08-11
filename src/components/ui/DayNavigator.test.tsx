import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DayNavigator } from "./DayNavigator";

/**
 * Covers design doc §3.4 "Previous / Next day navigation on /food and /metrics" and the §6 "Day
 * navigation" acceptance block: exactly two buttons (no "Today"), "Next day" disabled on `today`
 * only, `shiftIsoDate` doing the arithmetic, icon-only chevrons named via `aria-label` (2026-08-10
 * amendment — see `ai-context/DECISIONS.md`), and every change routed through the caller's own
 * `onChange` (never a separate choke point of its own).
 */
describe("DayNavigator", () => {
  it("renders exactly two navigation buttons and no 'Today' control", () => {
    render(<DayNavigator id="food-day" value="2026-07-15" today="2026-07-20" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Previous day/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Next day/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Today$/ })).not.toBeInTheDocument();
  });

  it("the date input carries the given id, value and max=today", () => {
    render(<DayNavigator id="metric-day" value="2026-07-15" today="2026-07-20" onChange={vi.fn()} />);
    const input = screen.getByLabelText("Day") as HTMLInputElement;
    expect(input.id).toBe("metric-day");
    expect(input.value).toBe("2026-07-15");
    expect(input.max).toBe("2026-07-20");
  });

  it("'Previous day' calls onChange with the day before, via shiftIsoDate", () => {
    const onChange = vi.fn();
    render(<DayNavigator id="food-day" value="2026-08-01" today="2026-08-05" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Previous day/ }));
    expect(onChange).toHaveBeenCalledWith("2026-07-31");
  });

  it("'Next day' calls onChange with the day after, when enabled", () => {
    const onChange = vi.fn();
    render(<DayNavigator id="food-day" value="2026-07-15" today="2026-07-20" onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /Next day/ }));
    expect(onChange).toHaveBeenCalledWith("2026-07-16");
  });

  it("'Next day' is disabled exactly when the viewed day is today", () => {
    const { rerender } = render(
      <DayNavigator id="food-day" value="2026-07-19" today="2026-07-20" onChange={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /Next day/ })).toBeEnabled();

    rerender(<DayNavigator id="food-day" value="2026-07-20" today="2026-07-20" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Next day/ })).toBeDisabled();
  });

  it("'Previous day' has no lower bound and stays enabled arbitrarily far in the past", () => {
    render(<DayNavigator id="food-day" value="2020-01-01" today="2026-07-20" onChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /Previous day/ })).toBeEnabled();
  });

  it("changing the date input directly calls onChange with the picked value", () => {
    const onChange = vi.fn();
    render(<DayNavigator id="food-day" value="2026-07-15" today="2026-07-20" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("Day"), { target: { value: "2026-07-01" } });
    expect(onChange).toHaveBeenCalledWith("2026-07-01");
  });

  it("qa-review N-5: both buttons are disabled (not a silent no-op) when value is empty/invalid", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <DayNavigator id="food-day" value="" today="2026-07-20" onChange={onChange} />,
    );
    expect(screen.getByRole("button", { name: /Previous day/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Next day/ })).toBeDisabled();

    rerender(<DayNavigator id="food-day" value="not-a-date" today="2026-07-20" onChange={onChange} />);
    expect(screen.getByRole("button", { name: /Previous day/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Next day/ })).toBeDisabled();

    // Recovers once a valid date is provided again -- this isn't a stuck/broken state.
    rerender(<DayNavigator id="food-day" value="2026-07-15" today="2026-07-20" onChange={onChange} />);
    expect(screen.getByRole("button", { name: /Previous day/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /Next day/ })).toBeEnabled();
  });

  it("chevrons are icon-only: aria-label carries the exact former label text, no visible text remains", () => {
    render(<DayNavigator id="food-day" value="2026-07-15" today="2026-07-20" onChange={vi.fn()} />);
    const previous = screen.getByRole("button", { name: /Previous day/ });
    const next = screen.getByRole("button", { name: /Next day/ });
    expect(previous).toHaveAttribute("aria-label", "Previous day");
    expect(next).toHaveAttribute("aria-label", "Next day");
    expect(previous).toHaveTextContent("‹");
    expect(next).toHaveTextContent("›");
  });
});

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EntrySelectionBar } from "./EntrySelectionBar";

/**
 * Covers design doc §3.4 "Multi-select bulk actions" — the bar's own contract: it shows the
 * EFFECTIVE selected count (already intersected against loaded entries by the caller, per
 * `FoodDayView`), both bulk actions are `disabled` at N=0 (not hidden — the disabled state itself
 * explains the precondition), and each button fires exactly the callback it's wired to.
 */
describe("EntrySelectionBar", () => {
  it("shows the selected count", () => {
    render(
      <EntrySelectionBar
        selectedCount={3}
        onCopySelected={vi.fn()}
        onSaveSelectedAsMeal={vi.fn()}
        onClear={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByText("3 selected")).toBeInTheDocument();
  });

  it("disables both bulk actions at zero selected", () => {
    render(
      <EntrySelectionBar
        selectedCount={0}
        onCopySelected={vi.fn()}
        onSaveSelectedAsMeal={vi.fn()}
        onClear={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Copy selected" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Save selected as a meal" })).toBeDisabled();
  });

  it("enables both bulk actions once something is selected", () => {
    render(
      <EntrySelectionBar
        selectedCount={1}
        onCopySelected={vi.fn()}
        onSaveSelectedAsMeal={vi.fn()}
        onClear={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Copy selected" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Save selected as a meal" })).toBeEnabled();
  });

  it("Clear and Done are always enabled, even at zero selected", () => {
    render(
      <EntrySelectionBar
        selectedCount={0}
        onCopySelected={vi.fn()}
        onSaveSelectedAsMeal={vi.fn()}
        onClear={vi.fn()}
        onDone={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "Clear" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  });

  it("fires exactly the callback wired to each button", () => {
    const onCopySelected = vi.fn();
    const onSaveSelectedAsMeal = vi.fn();
    const onClear = vi.fn();
    const onDone = vi.fn();
    render(
      <EntrySelectionBar
        selectedCount={2}
        onCopySelected={onCopySelected}
        onSaveSelectedAsMeal={onSaveSelectedAsMeal}
        onClear={onClear}
        onDone={onDone}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy selected" }));
    expect(onCopySelected).toHaveBeenCalledTimes(1);
    expect(onSaveSelectedAsMeal).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save selected as a meal" }));
    expect(onSaveSelectedAsMeal).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onClear).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

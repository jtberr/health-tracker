import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { DisclosureButton } from "./DisclosureButton";

/**
 * Covers design doc §3.4 "Optional-detail expanders look like buttons, not links" (Phase 8k,
 * finding 1) — a real button, `aria-expanded`/`aria-controls` wiring, and the SAME visible label in
 * both states (the trigger stays rendered while open; only the chevron and `aria-expanded` change).
 */
describe("DisclosureButton", () => {
  it("renders as a real button with the given label", () => {
    render(
      <DisclosureButton label="Look up a food (barcode or search)" open={false} onToggle={vi.fn()} controls="panel-1" />,
    );
    expect(
      screen.getByRole("button", { name: "Look up a food (barcode or search)" }),
    ).toBeInTheDocument();
  });

  it("aria-expanded is false when collapsed and true when open", () => {
    const { rerender } = render(
      <DisclosureButton label="Add detail (quantity, unit)" open={false} onToggle={vi.fn()} controls="panel-2" />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "false");

    rerender(
      <DisclosureButton label="Add detail (quantity, unit)" open={true} onToggle={vi.fn()} controls="panel-2" />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-expanded", "true");
  });

  it("aria-controls resolves to the id passed in", () => {
    render(<DisclosureButton label="Add detail" open={false} onToggle={vi.fn()} controls="detail-panel-id" />);
    expect(screen.getByRole("button")).toHaveAttribute("aria-controls", "detail-panel-id");
  });

  it("the SAME label renders whether open or closed -- the trigger stays rendered while open", () => {
    const { rerender } = render(
      <DisclosureButton label="Look up a food (barcode or search)" open={false} onToggle={vi.fn()} controls="p" />,
    );
    expect(screen.getByText("Look up a food (barcode or search)")).toBeInTheDocument();

    rerender(
      <DisclosureButton label="Look up a food (barcode or search)" open={true} onToggle={vi.fn()} controls="p" />,
    );
    expect(screen.getByText("Look up a food (barcode or search)")).toBeInTheDocument();
    // Still exactly one button -- not replaced by a second, separate dismiss control.
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("clicking calls onToggle exactly once", () => {
    const onToggle = vi.fn();
    render(<DisclosureButton label="Add detail" open={false} onToggle={onToggle} controls="p" />);
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("the glyph is aria-hidden -- the accessible name comes only from the visible label", () => {
    render(<DisclosureButton label="Add detail" open={false} onToggle={vi.fn()} controls="p" />);
    const svg = screen.getByRole("button").querySelector("svg");
    expect(svg).toHaveAttribute("aria-hidden", "true");
  });
});

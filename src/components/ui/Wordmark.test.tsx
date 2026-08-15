import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import Link from "next/link";
import { Wordmark } from "./Wordmark";

/**
 * Covers design doc §8 Phase 8l's implementation invariant: Wordmark renders plain text spans and
 * NO `aria-label`, so any consumer's accessible name (e.g. the header's <Link>) is unaffected by
 * the two-tone treatment -- it stays exactly "Health Tracker".
 */
describe("Wordmark", () => {
  it("renders the exact text 'Health Tracker' (normalized whitespace across the two spans)", () => {
    const { container } = render(<Wordmark />);
    expect(container.textContent?.replace(/\s+/g, " ").trim()).toBe("Health Tracker");
  });

  it("splits the two words into separate spans so they can be colored independently", () => {
    render(<Wordmark />);
    const health = screen.getByText("Health");
    const tracker = screen.getByText("Tracker");
    expect(health.tagName).toBe("SPAN");
    expect(tracker.tagName).toBe("SPAN");
    expect(health).not.toBe(tracker);
  });

  it("'Health' uses --ink and 'Tracker' uses --accent -- the one taste call in Phase 8l", () => {
    render(<Wordmark />);
    expect(screen.getByText("Health")).toHaveClass("text-ink");
    expect(screen.getByText("Tracker")).toHaveClass("text-accent");
  });

  it("renders no aria-label anywhere, so a wrapping link's accessible name is never overridden", () => {
    render(<Wordmark />);
    const health = screen.getByText("Health");
    expect(health.closest("[aria-label]")).toBeNull();
    // Also confirm neither span itself carries one.
    expect(screen.getByText("Health")).not.toHaveAttribute("aria-label");
    expect(screen.getByText("Tracker")).not.toHaveAttribute("aria-label");
  });

  it("does not add any svg or other decorative element -- text only", () => {
    const { container } = render(<Wordmark />);
    expect(container.querySelectorAll("svg")).toHaveLength(0);
  });

  it("a wrapping <Link> resolves an accessible name of exactly 'Health Tracker' -- the invariant the header depends on", () => {
    render(
      <Link href="/">
        <Wordmark />
      </Link>,
    );
    expect(screen.getByRole("link", { name: "Health Tracker" })).toBeInTheDocument();
  });

  it("applies an optional className to the outer wrapper for per-context sizing", () => {
    render(<Wordmark className="text-3xl font-semibold tracking-tight" />);
    const health = screen.getByText("Health");
    const outer = health.parentElement;
    expect(outer).toHaveClass("text-3xl", "font-semibold", "tracking-tight");
  });

  it("renders with no className given at all (default empty string)", () => {
    expect(() => render(<Wordmark />)).not.toThrow();
  });

  it("keeps the two words together on one line via whitespace-nowrap, even in a cramped header", () => {
    render(<Wordmark />);
    const outer = screen.getByText("Health").parentElement;
    expect(outer).toHaveClass("whitespace-nowrap");
  });
});

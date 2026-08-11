import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ActionPanel } from "./ActionPanel";

/**
 * Covers design doc §3.4 "Inline actions awaiting completion get real emphasis" — level 3 of the
 * emphasis ladder. `scrollIntoView` is stubbed globally in vitest.setup.ts (jsdom doesn't implement
 * it at all).
 */

/** jsdom doesn't implement `window.matchMedia` either -- stub it per-test so each test controls
 * whether `(prefers-reduced-motion: reduce)` matches. */
function mockMatchMedia(prefersReducedMotion: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: prefersReducedMotion && query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe("ActionPanel", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders as a role=region labelled by its own visible heading", () => {
    render(
      <ActionPanel heading="Save as meal">
        <p>content</p>
      </ActionPanel>,
    );
    const region = screen.getByRole("region", { name: "Save as meal" });
    expect(region).toBeInTheDocument();
    expect(screen.getByText("Save as meal")).toBeInTheDocument();
  });

  it("moves focus to the first focusable control inside on mount", () => {
    render(
      <ActionPanel heading="Copy this group">
        <label htmlFor="target-date">Copy to date</label>
        <input id="target-date" type="date" />
        <button type="button">Copy group</button>
      </ActionPanel>,
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Copy to date"));
  });

  it("does not throw when there is no focusable control at all", () => {
    expect(() =>
      render(
        <ActionPanel heading="Empty panel">
          <p>Nothing to focus here.</p>
        </ActionPanel>,
      ),
    ).not.toThrow();
  });

  it("renders its own children", () => {
    render(
      <ActionPanel heading="Copy selected">
        <p>3 items to copy</p>
      </ActionPanel>,
    );
    expect(screen.getByText("3 items to copy")).toBeInTheDocument();
  });

  it("qa-review N-2: the heading is a real <h3> element, not just a <p> wired via aria-labelledby", () => {
    render(
      <ActionPanel heading="Save as meal">
        <p>content</p>
      </ActionPanel>,
    );
    const heading = screen.getByRole("heading", { level: 3, name: "Save as meal" });
    expect(heading.tagName).toBe("H3");
  });

  it("qa-review N-7: scrolls with behavior 'smooth' when the user has no reduced-motion preference", () => {
    mockMatchMedia(false);
    const spy = vi.spyOn(Element.prototype, "scrollIntoView");
    render(
      <ActionPanel heading="Copy this day">
        <p>content</p>
      </ActionPanel>,
    );
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth", block: "nearest" }));
  });

  it("qa-review N-7: scrolls with behavior 'auto' when prefers-reduced-motion: reduce is set", () => {
    mockMatchMedia(true);
    const spy = vi.spyOn(Element.prototype, "scrollIntoView");
    render(
      <ActionPanel heading="Copy this day">
        <p>content</p>
      </ActionPanel>,
    );
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto", block: "nearest" }));
  });
});

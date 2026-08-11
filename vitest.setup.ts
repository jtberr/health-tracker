// Registers `@testing-library/jest-dom`'s DOM-specific matchers (`toBeInTheDocument`,
// `toBeDisabled`, `toBeEnabled`, `toHaveTextContent`, etc.) on Vitest's `expect`, for the
// component-level tests that render into jsdom (e.g. `StatusMessage.test.tsx`,
// `EntrySelectionBar.test.tsx`, `CopyGroupDialog.test.tsx` — Phase 8b). `@testing-library/jest-dom`
// was already an installed dependency (added alongside `@testing-library/react` for
// `BarcodeScanner.test.tsx`, Phase 6) but was never actually wired up via a setup file — that
// component test happened not to need any DOM-specific matcher, so the gap went unnoticed until
// these new tests needed one. The `/vitest` subpath is this package's dedicated entry point for
// Vitest (as opposed to `/jest-globals` for Jest), registering matchers via `expect.extend` the
// same way regardless of test runner.
import "@testing-library/jest-dom/vitest";

// jsdom does not implement `Element.prototype.scrollIntoView` at all -- calling it throws
// `TypeError: ... scrollIntoView is not a function` (confirmed directly, not assumed). Real
// browsers implement it, so this is purely a test-environment gap, not a production bug --
// `components/ui/ActionPanel.tsx` (Phase 8d) and `FoodEntryForm.tsx`'s edit-mode mount effect both
// call it, so any component test that renders either would otherwise crash on an unrelated
// assertion. A global no-op here means individual test files never need to re-stub this themselves.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// jsdom does not implement `window.matchMedia` either (same class of gap as scrollIntoView above).
// `components/ui/ActionPanel.tsx`'s prefers-reduced-motion guard (qa-review N-7, Phase 8d) calls it
// unconditionally on every mount, so any component test rendering it would otherwise crash on an
// unrelated assertion. Defaults every query to NOT matching (i.e. "no reduced-motion preference"),
// matching a typical default OS/browser setting -- a test that specifically needs to simulate
// `prefers-reduced-motion: reduce` overrides `window.matchMedia` itself (see
// `ActionPanel.test.tsx`'s `mockMatchMedia` helper), which simply replaces this default.
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

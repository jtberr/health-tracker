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

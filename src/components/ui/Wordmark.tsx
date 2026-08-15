/**
 * The one "Health Tracker" wordmark, used by the authenticated app header (`(app)/layout.tsx`)
 * AND the auth screens (`(auth)/layout.tsx`) — a single source of truth for the app's name, per
 * design doc §3.1/§8 Phase 8l.
 *
 * Treatment: type and one token, not a graphic — "Health" in `--ink`, "Tracker" in `--accent`.
 * This is the "wordmark mark" role Phase 8i's own token table already reserved for `--accent` but
 * never used. Both halves are AA on white (17.85:1 and 6.70:1) and colour carries no information
 * (the two words read identically either way), so WCAG 1.4.1 is not engaged.
 *
 * Implementation invariant (do not break this): renders plain text spans and NO `aria-label` — the
 * two spans' text content is exactly "Health" + " " + "Tracker", so any consumer's accessible name
 * (e.g. the header's `<Link>`) stays exactly "Health Tracker", unchanged from the bare string this
 * replaces. Adding an `aria-label` here would silently change that name for every consumer.
 *
 * `className` sizes/weights the wordmark for its context (the header wants a small `text-base`;
 * the auth screens want a large, prominent size) — the component itself only ever supplies colour.
 *
 * `whitespace-nowrap` on the outer wrapper: without it, a cramped header (e.g. a long user email
 * alongside every nav link at a mid-size viewport) can wrap the text between "Health" and
 * "Tracker" — which reads far more awkwardly split across two colours on two lines than the old
 * plain string ever did. This does not change whether the *rest* of the header row wraps/overflows
 * (unrelated, pre-existing, out of Phase 8l's scope) — only the wordmark's own two words stay
 * together as one unit wherever they render.
 *
 * The two-tone treatment is the one taste call in Phase 8l (see ai-context/DECISIONS.md's
 * 2026-08-11 entry) — if it's ever rejected, the fallback is a single `text-ink` span, a one-line
 * change confined to this file.
 */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <span className={`whitespace-nowrap ${className}`}>
      <span className="text-ink">Health</span> <span className="text-accent">Tracker</span>
    </span>
  );
}

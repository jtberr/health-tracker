import type { HTMLAttributes } from "react";

/**
 * Shared card surface (rounded, bordered, subtle shadow) used for forms, stat rows, and lists.
 *
 * NB-2 fix (qa-reviewer, 2026-07-26): border-stone-200 (#e7e5e4) measured 1.26:1 on white (needs
 * 3:1 for the WCAG 1.4.11 non-text/UI-component threshold). stone-500 (#78716c) was the nearest
 * step up in the same warm-neutral family that cleared it: 4.80:1 on white.
 *
 * Phase 8i (2026-08-09/10, "Visual identity v2") DELIBERATELY REVERSES that fix's border for THIS
 * component, back to a subtle `--line` (1.49:1) — not a re-litigation of the same question, but a
 * different SC-scope argument: 1.4.11 covers "visual information required to identify user
 * interface components and states" and "graphics required to understand the content", and a card
 * is neither — it's a decorative grouping container, and nothing inside it loses legibility if its
 * edge is unperceived. Heavy 4.80:1 borders on every card were a large part of what read as
 * "busy". The half of NB-2 that DOES apply to real components is kept and EXTENDED: `inputClass`,
 * `Button` secondary, and any select/interactive outline use `--line-strong` (≥3:1). See
 * ai-context/DECISIONS.md's Phase 8i entry for the full reasoning and the standing rule this
 * leaves behind: UI components -> line-strong; decorative containers/dividers -> line.
 */
export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`rounded-xl border border-line bg-white shadow-sm ${className}`} />;
}

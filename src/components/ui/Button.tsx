import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger";
type Size = "sm" | "md" | "icon";

// Phase 8i (2026-08-09/10, "Visual identity v2"): primary -> bg-accent text-white (was bg-ink
// text-paper); secondary border -> line-strong, a genuine SC 1.4.11 defect this round found and
// fixed (border-stone-300 was 1.49:1 on white, under the 3:1 non-text/UI-component bar -- the
// 2026-07-26 NB-2 sweep fixed styles.ts/Card and missed this) -- see ai-context/DECISIONS.md.
// danger stays unchanged (semantic red, out of scope for this round).
const variantClass: Record<Variant, string> = {
  primary:
    "bg-accent text-white shadow-sm hover:bg-accent/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:bg-accent/40",
  secondary:
    "border border-line-strong bg-white text-ink shadow-sm hover:bg-slate-50 disabled:text-muted",
  danger:
    "border border-red-200 bg-white text-red-600 shadow-sm hover:bg-red-50 disabled:text-red-300",
};

/** `icon` (2026-08-07, Phase 8g) is for the icon-only row actions ("Icons replace buttons+text
 * entirely" -- ai-context/DECISIONS.md): generous square tap padding around a single glyph, no
 * text sizing since there's no text. */
const sizeClass: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-4 py-2 text-sm",
  icon: "p-2.5",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

/** Shared button look across the app — see `components/ui/` in the design doc's §3.1 module tree.
 * Rounded-RECTANGLE shape (2026-08-09/10, Phase 8i): actions are `rounded-lg` -- pills survive only
 * for status/selection (NavLink, the "From a saved meal"/"Pinned"/"Editing" badges), per the shape
 * rule recorded in ai-context/DECISIONS.md's Phase 8i entry. */
export function Button({ variant = "primary", size = "md", className = "", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${variantClass[variant]} ${sizeClass[size]} ${className}`}
    />
  );
}

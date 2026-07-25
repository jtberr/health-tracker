import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger";
type Size = "sm" | "md";

const variantClass: Record<Variant, string> = {
  primary:
    "bg-ink text-paper shadow-sm hover:bg-ink/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sage-deep disabled:bg-ink/40",
  secondary:
    "border border-stone-300 bg-white text-ink shadow-sm hover:bg-stone-50 disabled:text-stone-400",
  danger:
    "border border-red-200 bg-white text-red-600 shadow-sm hover:bg-red-50 disabled:text-red-300",
};

const sizeClass: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-4 py-2 text-sm",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
};

/** Shared button look across the app — see `components/ui/` in the design doc's §3.1 module tree. */
export function Button({ variant = "primary", size = "md", className = "", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={`rounded-full font-medium transition-colors disabled:cursor-not-allowed ${variantClass[variant]} ${sizeClass[size]} ${className}`}
    />
  );
}

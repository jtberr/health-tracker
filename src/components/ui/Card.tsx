import type { HTMLAttributes } from "react";

/** Shared card surface (rounded, bordered, subtle shadow) used for forms, stat rows, and lists. */
export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={`rounded-xl border border-zinc-200 bg-white shadow-sm ${className}`} />;
}

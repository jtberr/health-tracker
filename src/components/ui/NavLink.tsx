"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Top nav link that highlights itself when its route (or a sub-route of it) is active.
 * Phase 8i (2026-08-09/10): active -> bg-accent-soft text-ink (was bg-sage-pale text-ink) — STAYS
 * a pill (`rounded-full`), unaffected by `Button`'s rounded-lg shape change, per the "pills survive
 * for status and selection" rule (ai-context/DECISIONS.md's Phase 8i entry). */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`rounded-full px-2.5 py-1.5 font-medium transition-colors ${
        isActive ? "bg-accent-soft text-ink" : "text-muted hover:bg-slate-100 hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** Top nav link that highlights itself when its route (or a sub-route of it) is active. */
export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const isActive = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={isActive ? "page" : undefined}
      className={`rounded-full px-2.5 py-1.5 font-medium transition-colors ${
        isActive ? "bg-sage-pale text-ink" : "text-stone-600 hover:bg-stone-100 hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

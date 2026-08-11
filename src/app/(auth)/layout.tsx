import { Card } from "@/components/ui/Card";

/**
 * Phase 8i (2026-08-09/10, "Visual identity v2"): the decorative "sage arc" motif is DELETED, not
 * recolored — the reference direction is explicitly undecorated, and recolouring it would keep
 * `--sage` (a token this round doesn't replace) alive for its one remaining consumer. See
 * ai-context/DECISIONS.md's Phase 8i entry ("Deleting the sage arc rather than restyling it").
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center bg-canvas px-4 py-16">
      <Card className="w-full max-w-sm p-8">{children}</Card>
    </div>
  );
}

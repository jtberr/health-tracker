import { Card } from "@/components/ui/Card";
import { Wordmark } from "@/components/ui/Wordmark";

/**
 * Phase 8i (2026-08-09/10, "Visual identity v2"): the decorative "sage arc" motif is DELETED, not
 * recolored — the reference direction is explicitly undecorated, and recolouring it would keep
 * `--sage` (a token this round doesn't replace) alive for its one remaining consumer. See
 * ai-context/DECISIONS.md's Phase 8i entry ("Deleting the sage arc rather than restyling it").
 *
 * Phase 8l (2026-08-11): the app's first screen never said what the app was -- every authenticated
 * screen has "Health Tracker" in its header, but /login and /signup had it nowhere. Fixed with type
 * and one token, not a graphic: the shared Wordmark above the card, a one-line tagline beneath it,
 * and a stronger shadow on this card only (via className, not a change to Card itself). No
 * decorative <svg> is reintroduced -- e2e/visual-identity-acceptance.spec.ts's zero-app-owned-<svg>
 * guard on /login and /signup must keep passing unedited; see ai-context/DECISIONS.md's Phase 8l
 * entry for the full reasoning.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-canvas px-4 py-16">
      <div className="flex flex-col items-center gap-1 text-center">
        <Wordmark className="text-3xl font-semibold tracking-tight" />
        <p className="text-sm text-muted">Log food, weight and body fat in seconds.</p>
      </div>
      <Card className="w-full max-w-sm p-8 shadow-lg!">{children}</Card>
    </div>
  );
}

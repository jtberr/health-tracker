import type { Metadata } from "next";
import { LoginForm } from "./LoginForm";

export const metadata: Metadata = { title: "Log in — Health Tracker" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; reset?: string }>;
}) {
  const { error, reset } = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-ink">Log in</h1>
      {error === "auth_callback_failed" && (
        // Phase 8m (2026-08-11/15): generalised from signup-specific copy, since this same
        // ?error=auth_callback_failed flag now also fires for an expired/reused password-reset
        // link (both flows share the one /auth/callback Route Handler). Must keep the substring
        // "invalid or expired" — e2e/phase1-acceptance.spec.ts asserts on it.
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          That link is invalid or expired. Try logging in, or request a new confirmation email or
          password reset.
        </p>
      )}
      {reset === "success" && (
        // Phase 8m: the confirmation shown after a successful password reset — updatePassword
        // signs the recovery session out and redirects here, per ai-context/DECISIONS.md's Phase
        // 8m entry, reusing this same query-flag notice mechanism (no new pattern).
        <p className="rounded-md bg-accent-soft px-3 py-2 text-sm text-ink">
          Your password has been reset. Log in with your new password below.
        </p>
      )}
      <LoginForm />
    </div>
  );
}

import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = { title: "Set a new password — Health Tracker" };

/**
 * Phase 8m (2026-08-11/15). `(auth)/` has no auth gate by design (login/signup must be reachable
 * logged-out), so this page is reachable with no session at all — a bookmarked URL, an expired
 * link, or a link opened in a different browser than the one that requested it. It therefore does
 * its OWN server-side session check before ever rendering a form: with no session, render an
 * explanatory "invalid or has expired" state (no password inputs at all — a form that renders and
 * then can only fail on submit is the failure mode this page exists to avoid), rather than a dead
 * form. This is a UX affordance only, never the authorisation control — `updatePassword` performs
 * the identical, independent check server-side regardless of what this page rendered (see
 * lib/actions/auth.ts and ai-context/DECISIONS.md's Phase 8m entry).
 */
export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h1 className="text-2xl font-semibold text-ink">Link expired</h1>
        <p className="text-sm text-muted">That reset link is invalid or has expired.</p>
        <Link href="/forgot-password" className="text-sm font-medium text-accent underline">
          Request a new link
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-ink">Set a new password</h1>
      <ResetPasswordForm />
    </div>
  );
}

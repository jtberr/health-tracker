"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { updatePassword, type AuthActionState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/Button";
import { errorTextClass, inputClass, labelClass } from "@/components/ui/styles";

const initialState: AuthActionState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Saving..." : "Set new password"}
    </Button>
  );
}

/**
 * Phase 8m (2026-08-11/15). `updatePassword` redirects on success (`/login?reset=success`), so
 * this form has no success state of its own to render — only field errors and the one deliberate
 * short error code, `"reset_session_missing"`, which the page's own server-side check (see
 * `page.tsx`) already keeps this form from normally ever reaching; it's a defensive fallback for a
 * session that expires between page load and this submit, not the primary path.
 */
export function ResetPasswordForm() {
  const [state, formAction] = useActionState(updatePassword, initialState);

  const isExpiredSession = state.error === "reset_session_missing";

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate autoComplete="off">
      <div className="flex flex-col gap-1">
        <label htmlFor="password" className={labelClass}>
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={6}
          className={inputClass}
        />
        {state.fieldErrors?.password && (
          <p className={errorTextClass}>{state.fieldErrors.password}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="confirmPassword" className={labelClass}>
          Confirm new password
        </label>
        <input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          className={inputClass}
        />
        {state.fieldErrors?.confirmPassword && (
          <p className={errorTextClass}>{state.fieldErrors.confirmPassword}</p>
        )}
      </div>

      {state.error && isExpiredSession && (
        <p className={errorTextClass}>
          That reset link is invalid or has expired.{" "}
          <Link href="/forgot-password" className="font-medium underline">
            Request a new one
          </Link>
          .
        </p>
      )}
      {state.error && !isExpiredSession && <p className={errorTextClass}>{state.error}</p>}

      <SubmitButton />
    </form>
  );
}

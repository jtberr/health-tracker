"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { requestPasswordReset, type AuthActionState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/Button";
import { errorTextClass, inputClass, labelClass } from "@/components/ui/styles";

const initialState: AuthActionState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Sending..." : "Send reset link"}
    </Button>
  );
}

/**
 * Phase 8m (2026-08-11/15). `requestPasswordReset` always returns the SAME `info` message on a
 * successful call, regardless of whether the address has an account — see
 * ai-context/DECISIONS.md's Phase 8m entry. This form must never show a different message for
 * "no such account"; it only has two rendered states, `info` (neutral confirmation, any address)
 * and `error` (a genuine send failure, or a field-level validation error).
 */
export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordReset, initialState);

  if (state.info) {
    return (
      <div className="flex flex-col gap-3 text-center">
        <p className="text-sm text-muted">{state.info}</p>
        <Link href="/login" className="text-sm font-medium text-accent underline">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate autoComplete="off">
      <p className="text-sm text-muted">
        Enter the email address on your account and we&apos;ll send you a link to reset your
        password.
      </p>

      <div className="flex flex-col gap-1">
        <label htmlFor="email" className={labelClass}>
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className={inputClass}
        />
        {state.fieldErrors?.email && <p className={errorTextClass}>{state.fieldErrors.email}</p>}
      </div>

      {state.error && <p className={errorTextClass}>{state.error}</p>}

      <SubmitButton />

      <p className="text-center text-sm text-muted">
        <Link href="/login" className="font-medium text-accent underline">
          Back to log in
        </Link>
      </p>
    </form>
  );
}

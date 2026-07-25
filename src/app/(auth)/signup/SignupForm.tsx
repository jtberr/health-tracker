"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { signUp, type AuthActionState } from "@/lib/actions/auth";
import { Button } from "@/components/ui/Button";
import { errorTextClass, inputClass, labelClass } from "@/components/ui/styles";

const initialState: AuthActionState = { error: null };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? "Signing up..." : "Sign up"}
    </Button>
  );
}

export function SignupForm() {
  const [state, formAction] = useActionState(signUp, initialState);

  if (state.info) {
    return (
      <div className="flex flex-col gap-3 text-center">
        <h1 className="font-serif text-2xl font-semibold text-ink">Almost there</h1>
        <p className="text-sm text-stone-600">{state.info}</p>
        <Link href="/login" className="text-sm font-medium text-sage-deep underline">
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-4" noValidate>
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
        {state.fieldErrors?.email && (
          <p className={errorTextClass}>{state.fieldErrors.email}</p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password" className={labelClass}>
          Password
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
          Confirm password
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

      {state.error && <p className={errorTextClass}>{state.error}</p>}

      <SubmitButton />

      <p className="text-center text-sm text-stone-600">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-sage-deep underline">
          Log in
        </Link>
      </p>
    </form>
  );
}

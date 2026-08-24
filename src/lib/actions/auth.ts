"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  validateForgotPasswordInput,
  validateLoginInput,
  validateNewPasswordInput,
  validateSignupInput,
} from "@/lib/domain/auth-validation";

/**
 * Server Actions for auth — the Web Forms analogue of a code-behind `Button1_Click`, except
 * explicitly invoked from a `<form action={...}>` and type-checked end-to-end, with no ViewState
 * or page lifecycle underneath it (see AGENTS.md).
 *
 * `user_id` is never accepted as input here — every one of these resolves the acting user from
 * the Supabase-session-bound server client, never from the form.
 */

export type AuthActionState = {
  error: string | null;
  fieldErrors?: Partial<Record<"email" | "password" | "confirmPassword", string>>;
  info?: string | null;
};

export async function signIn(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const validation = validateLoginInput({ email, password });
  if (!validation.ok) {
    return { error: "Please fix the highlighted errors.", fieldErrors: toFieldErrors(validation.errors) };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: error.message };
  }

  redirect("/");
}

export async function signUp(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const validation = validateSignupInput({ email, password, confirmPassword });
  if (!validation.ok) {
    return { error: "Please fix the highlighted errors.", fieldErrors: toFieldErrors(validation.errors) };
  }

  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  });

  if (error) {
    return { error: error.message };
  }

  // Supabase's built-in email confirmation (settled per ai-context/DECISIONS.md — no custom SMTP
  // for v1): the account exists but is unconfirmed until the user clicks the emailed link, which
  // lands on /auth/callback. There is no session yet, so we don't redirect into the app.
  return {
    error: null,
    info: "Check your email to confirm your account before logging in.",
  };
}

/**
 * Phase 8m (2026-08-11/15): request a Supabase-built-in password-reset email. Always returns the
 * SAME neutral confirmation on success, regardless of whether an account exists for `email` — see
 * ai-context/DECISIONS.md's Phase 8m entry. `resetPasswordForEmail` does not itself distinguish
 * "no such account" from success (confirmed against this Supabase version rather than assumed —
 * see the Phase 8m PROGRESS.md entry for how that was checked), so any `error` here is a genuine
 * transport/rate-limit failure and gets its own distinct message; folding it into the neutral
 * confirmation would falsely tell the user an email is on its way.
 *
 * The recovery link lands on the EXISTING `/auth/callback` (no second Route Handler — see
 * ai-context/DECISIONS.md), which exchanges the code for a session server-side and forwards to
 * `?next=/reset-password`.
 */
export async function requestPasswordReset(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "");

  const validation = validateForgotPasswordInput({ email });
  if (!validation.ok) {
    return { error: "Please fix the highlighted errors.", fieldErrors: toFieldErrors(validation.errors) };
  }

  const supabase = await createClient();
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });

  if (error) {
    return { error: "Couldn't send a reset email right now. Please try again in a few minutes." };
  }

  return {
    error: null,
    info: "If an account exists for that address, we've sent a link to reset your password.",
  };
}

/**
 * Phase 8m (2026-08-11/15): sets a new password for whoever the CURRENT session is — the recovery
 * session minted by `/auth/callback`'s code exchange. `(auth)/reset-password/page.tsx` already
 * performs the identical `getUser()` check before ever rendering a form, but that page-level check
 * is a UX affordance only, never the authorisation control (ai-context/DECISIONS.md's Phase 8m
 * entry) — this action independently re-checks, so a direct call with no session is rejected
 * regardless of what the page rendered (e.g. a session that expired between page load and submit).
 *
 * On success: sign the recovery session out (it was granted by possession of an emailed link, not
 * by knowledge of the new password) and send the user to log in with it, proving it actually works.
 */
export async function updatePassword(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  const validation = validateNewPasswordInput({ password, confirmPassword });
  if (!validation.ok) {
    return { error: "Please fix the highlighted errors.", fieldErrors: toFieldErrors(validation.errors) };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "reset_session_missing" };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.message };
  }

  await supabase.auth.signOut();
  redirect("/login?reset=success");
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

function toFieldErrors(
  errors: { field: "email" | "password" | "confirmPassword"; message: string }[],
): AuthActionState["fieldErrors"] {
  const out: AuthActionState["fieldErrors"] = {};
  for (const e of errors) {
    out[e.field] = e.message;
  }
  return out;
}

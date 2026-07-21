"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { validateLoginInput, validateSignupInput } from "@/lib/domain/auth-validation";

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
    return { error: "Please fix the errors below.", fieldErrors: toFieldErrors(validation.errors) };
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
    return { error: "Please fix the errors below.", fieldErrors: toFieldErrors(validation.errors) };
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

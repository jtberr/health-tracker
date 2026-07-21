/**
 * Pure, framework-free validation for the login/signup forms. No Next.js/React/Supabase imports —
 * this is the primary unit-test target per the project conventions (AGENTS.md).
 *
 * Deliberately mirrors (but does not depend on) Supabase Auth's own server-side rules, so we can
 * reject obviously-bad input before making a network call — the server-side Supabase call remains
 * the actual source of truth (e.g. "email already registered" can only be known there).
 */

export type FieldError = { field: "email" | "password" | "confirmPassword"; message: string };
export type ValidationResult = { ok: true } | { ok: false; errors: FieldError[] };

/** Supabase's own default minimum password length. */
export const MIN_PASSWORD_LENGTH = 6;

/** Deliberately permissive — real validity is enforced by Supabase's confirmation email, not by us. */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email.trim());
}

export function isValidPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

export function validateLoginInput(input: { email: string; password: string }): ValidationResult {
  const errors: FieldError[] = [];

  if (!input.email.trim()) {
    errors.push({ field: "email", message: "Email is required." });
  } else if (!isValidEmail(input.email)) {
    errors.push({ field: "email", message: "Enter a valid email address." });
  }

  if (!input.password) {
    errors.push({ field: "password", message: "Password is required." });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

export function validateSignupInput(input: {
  email: string;
  password: string;
  confirmPassword: string;
}): ValidationResult {
  const errors: FieldError[] = [];

  if (!input.email.trim()) {
    errors.push({ field: "email", message: "Email is required." });
  } else if (!isValidEmail(input.email)) {
    errors.push({ field: "email", message: "Enter a valid email address." });
  }

  if (!input.password) {
    errors.push({ field: "password", message: "Password is required." });
  } else if (!isValidPassword(input.password)) {
    errors.push({
      field: "password",
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
    });
  }

  if (input.confirmPassword !== input.password) {
    errors.push({ field: "confirmPassword", message: "Passwords do not match." });
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true };
}

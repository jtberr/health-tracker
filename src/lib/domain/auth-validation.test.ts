import { describe, expect, it } from "vitest";
import {
  isValidEmail,
  isValidPassword,
  MIN_PASSWORD_LENGTH,
  validateForgotPasswordInput,
  validateLoginInput,
  validateNewPasswordInput,
  validateSignupInput,
} from "./auth-validation";

describe("isValidEmail", () => {
  it("accepts a normal email", () => {
    expect(isValidEmail("jeff@example.com")).toBe(true);
  });

  it("accepts an email with leading/trailing whitespace", () => {
    expect(isValidEmail("  jeff@example.com  ")).toBe(true);
  });

  it.each(["", "not-an-email", "missing-domain@", "@missing-local.com", "no-at-sign.com", "two@@at.com"])(
    "rejects %p",
    (bad) => {
      expect(isValidEmail(bad)).toBe(false);
    },
  );
});

describe("isValidPassword", () => {
  it(`accepts a password exactly ${MIN_PASSWORD_LENGTH} characters long`, () => {
    expect(isValidPassword("a".repeat(MIN_PASSWORD_LENGTH))).toBe(true);
  });

  it("accepts a long password", () => {
    expect(isValidPassword("a-very-long-and-secure-password")).toBe(true);
  });

  it(`rejects a password one character short of ${MIN_PASSWORD_LENGTH}`, () => {
    expect(isValidPassword("a".repeat(MIN_PASSWORD_LENGTH - 1))).toBe(false);
  });

  it("rejects an empty password", () => {
    expect(isValidPassword("")).toBe(false);
  });
});

describe("validateLoginInput", () => {
  it("accepts valid email + non-empty password", () => {
    const result = validateLoginInput({ email: "jeff@example.com", password: "whatever" });
    expect(result.ok).toBe(true);
  });

  it("rejects missing email", () => {
    const result = validateLoginInput({ email: "", password: "whatever" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === "email")).toBe(true);
    }
  });

  it("rejects malformed email", () => {
    const result = validateLoginInput({ email: "not-an-email", password: "whatever" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === "email")).toBe(true);
    }
  });

  it("rejects missing password", () => {
    const result = validateLoginInput({ email: "jeff@example.com", password: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.field === "password")).toBe(true);
    }
  });

  it("does NOT enforce the minimum-length rule on login (only signup)", () => {
    // A login attempt with a short password should fail against the real backend (wrong
    // credentials), not be rejected client-side as "too short" — only signup enforces the
    // minimum, since we don't want to reject a legitimately-short-but-wrong password locally
    // in a way that leaks information about the rule.
    const result = validateLoginInput({ email: "jeff@example.com", password: "ab" });
    expect(result.ok).toBe(true);
  });

  it("reports multiple errors at once", () => {
    const result = validateLoginInput({ email: "", password: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(2);
    }
  });
});

describe("validateSignupInput", () => {
  const base = { email: "jeff@example.com", password: "password1", confirmPassword: "password1" };

  it("accepts valid matching input", () => {
    expect(validateSignupInput(base).ok).toBe(true);
  });

  it("rejects missing email", () => {
    const result = validateSignupInput({ ...base, email: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "email")).toBe(true);
  });

  it("rejects malformed email", () => {
    const result = validateSignupInput({ ...base, email: "nope" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "email")).toBe(true);
  });

  it("rejects a too-short password", () => {
    const result = validateSignupInput({ ...base, password: "abc", confirmPassword: "abc" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "password")).toBe(true);
  });

  it("rejects mismatched confirmPassword", () => {
    const result = validateSignupInput({ ...base, confirmPassword: "different1" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "confirmPassword")).toBe(true);
  });

  it("treats an empty confirmPassword as a mismatch, not a separate 'required' error", () => {
    const result = validateSignupInput({ ...base, confirmPassword: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.filter((e) => e.field === "confirmPassword")).toHaveLength(1);
    }
  });

  it("reports all applicable errors at once", () => {
    const result = validateSignupInput({ email: "bad", password: "ab", confirmPassword: "xy" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.errors.map((e) => e.field).sort();
      expect(fields).toEqual(["confirmPassword", "email", "password"]);
    }
  });
});

// Phase 8m (2026-08-11/15): password reset.
describe("validateForgotPasswordInput", () => {
  it("accepts a valid email", () => {
    expect(validateForgotPasswordInput({ email: "jeff@example.com" }).ok).toBe(true);
  });

  it("rejects an empty email, reporting on the `email` field", () => {
    const result = validateForgotPasswordInput({ email: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("email");
    }
  });

  it("rejects a whitespace-only email", () => {
    const result = validateForgotPasswordInput({ email: "   " });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.field === "email")).toBe(true);
  });

  it("rejects a malformed email, reporting on the `email` field", () => {
    const result = validateForgotPasswordInput({ email: "not-an-email" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("email");
    }
  });
});

describe("validateNewPasswordInput", () => {
  it("accepts a valid, matching password pair", () => {
    const result = validateNewPasswordInput({
      password: "new-password-1",
      confirmPassword: "new-password-1",
    });
    expect(result.ok).toBe(true);
  });

  it(`rejects a password shorter than ${MIN_PASSWORD_LENGTH} characters, reporting on the "password" field`, () => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    const result = validateNewPasswordInput({ password: short, confirmPassword: short });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("password");
    }
  });

  it('rejects a mismatched confirmation, reporting on the "confirmPassword" field', () => {
    const result = validateNewPasswordInput({
      password: "new-password-1",
      confirmPassword: "different-password",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].field).toBe("confirmPassword");
    }
  });

  it("treats an empty confirmPassword as a mismatch, not a separate 'required' error", () => {
    const result = validateNewPasswordInput({ password: "new-password-1", confirmPassword: "" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.filter((e) => e.field === "confirmPassword")).toHaveLength(1);
    }
  });

  it("reports BOTH a too-short password AND a mismatched confirmation at once", () => {
    // The row the design doc calls out explicitly: the form must not show one problem, get it
    // fixed, and then reveal another.
    const result = validateNewPasswordInput({ password: "ab", confirmPassword: "xy" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const fields = result.errors.map((e) => e.field).sort();
      expect(fields).toEqual(["confirmPassword", "password"]);
    }
  });

  it("reuses isValidPassword/MIN_PASSWORD_LENGTH rather than a second hardcoded rule", () => {
    // A password exactly at the shared minimum, with a matching confirmation, must be accepted —
    // pins the shared constant/function rather than a locally-restated `6`.
    const atMinimum = "a".repeat(MIN_PASSWORD_LENGTH);
    expect(isValidPassword(atMinimum)).toBe(true);
    const result = validateNewPasswordInput({ password: atMinimum, confirmPassword: atMinimum });
    expect(result.ok).toBe(true);
  });
});

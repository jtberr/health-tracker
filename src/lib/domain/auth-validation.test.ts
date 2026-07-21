import { describe, expect, it } from "vitest";
import {
  isValidEmail,
  isValidPassword,
  MIN_PASSWORD_LENGTH,
  validateLoginInput,
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

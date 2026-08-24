import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MIN_PASSWORD_LENGTH,
  validateForgotPasswordInput,
  validateNewPasswordInput,
  validateSignupInput,
  type ValidationResult,
} from "./auth-validation";

/**
 * QA-REVIEWER independent unit suite for Phase 8m's two new pure validators.
 *
 * Written from docs/architecture/food-weight-tracker.md 3.3 (the two signatures + "the FieldError
 * union is UNCHANGED") and 6's `auth-validation.ts (Phase 8m additions)` bullet -- NOT from the
 * developer's own src/lib/domain/auth-validation.test.ts, which was read only afterwards to look
 * for gaps.
 *
 * 6 asks for one thing normally left to prose review -- "Both must reuse isValidEmail /
 * isValidPassword rather than restating the rules (checkable by review: a second regex or a second
 * literal 6 in this file is the defect)". That is made MECHANICAL at the bottom of this file, in
 * the same spirit as the existing autofill-hygiene decay guard, so the requirement survives a
 * future edit rather than depending on someone re-reading the file.
 */

const errorsOf = (r: ValidationResult) => (r.ok ? [] : r.errors);
const fieldsOf = (r: ValidationResult) => errorsOf(r).map((e) => e.field);

// The union as the design doc pins it. A new literal here would be a type break the two forms
// render as "nothing at all" (they only read .email / .password / .confirmPassword).
const ALLOWED_FIELDS = ["email", "password", "confirmPassword"];

describe("validateForgotPasswordInput (Phase 8m)", () => {
  it("rejects an empty email, on the email field", () => {
    const r = validateForgotPasswordInput({ email: "" });
    expect(r.ok).toBe(false);
    expect(fieldsOf(r)).toEqual(["email"]);
  });

  it("rejects a whitespace-only email (not merely a zero-length one)", () => {
    const r = validateForgotPasswordInput({ email: "   \t  " });
    expect(r.ok).toBe(false);
    expect(fieldsOf(r)).toEqual(["email"]);
  });

  it.each(["not-an-email", "no@tld", "@example.com", "user@", "two spaces@example.com"])(
    "rejects the malformed address %j",
    (email) => {
      expect(validateForgotPasswordInput({ email }).ok).toBe(false);
    },
  );

  it("accepts a valid address", () => {
    expect(validateForgotPasswordInput({ email: "jeff@example.com" }).ok).toBe(true);
  });

  it("accepts a valid address with surrounding whitespace (trimmed for validation)", () => {
    // Documents the validator's own contract. Verified separately against the running stack
    // that supabase-js normalises the address before the call, so a whitespace-padded paste
    // still results in a real email -- accepting-after-trim here creates no silent dead end.
    expect(validateForgotPasswordInput({ email: "  jeff@example.com  " }).ok).toBe(true);
  });

  it("never reports a field outside the unchanged FieldError union", () => {
    for (const email of ["", "   ", "nope", "a@b"]) {
      for (const f of fieldsOf(validateForgotPasswordInput({ email }))) {
        expect(ALLOWED_FIELDS).toContain(f);
      }
    }
  });

  it("agrees exactly with validateSignupInput email verdict for the same address", () => {
    // Behavioural proof of reuse: if a second, subtly different email rule were introduced here,
    // some address would be judged differently by the two validators.
    for (const email of ["", "   ", "nope", "a@b", "a@b.c", "  a@b.c  ", "x y@z.com"]) {
      const forgot = validateForgotPasswordInput({ email }).ok;
      const signupEmailOk = !fieldsOf(
        validateSignupInput({ email, password: "abcdef", confirmPassword: "abcdef" }),
      ).includes("email");
      expect(signupEmailOk, "disagreement on " + JSON.stringify(email)).toBe(forgot);
    }
  });
});

describe("validateNewPasswordInput (Phase 8m)", () => {
  it("accepts a valid matching pair", () => {
    expect(validateNewPasswordInput({ password: "abcdef", confirmPassword: "abcdef" }).ok).toBe(true);
  });

  it("rejects a password shorter than MIN_PASSWORD_LENGTH, on the password field", () => {
    const r = validateNewPasswordInput({ password: "abc", confirmPassword: "abc" });
    expect(r.ok).toBe(false);
    expect(fieldsOf(r)).toEqual(["password"]);
    expect(errorsOf(r)[0].message).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it("uses MIN_PASSWORD_LENGTH as the boundary exactly (len-1 rejected, len accepted)", () => {
    const justShort = "x".repeat(MIN_PASSWORD_LENGTH - 1);
    const exact = "x".repeat(MIN_PASSWORD_LENGTH);
    expect(validateNewPasswordInput({ password: justShort, confirmPassword: justShort }).ok).toBe(false);
    expect(validateNewPasswordInput({ password: exact, confirmPassword: exact }).ok).toBe(true);
  });

  it("rejects a mismatched confirmation, on the confirmPassword field", () => {
    const r = validateNewPasswordInput({ password: "abcdef", confirmPassword: "abcdeF" });
    expect(r.ok).toBe(false);
    expect(fieldsOf(r)).toEqual(["confirmPassword"]);
  });

  it("treats the confirmation comparison as exact (case- and whitespace-sensitive)", () => {
    expect(validateNewPasswordInput({ password: "abcdef", confirmPassword: "abcdef " }).ok).toBe(false);
  });

  it("reports BOTH problems at once when too short AND the confirmation differs", () => {
    // The row 6 singles out: the form must not show one problem, get it fixed, then reveal another.
    const r = validateNewPasswordInput({ password: "abc", confirmPassword: "zzz" });
    expect(r.ok).toBe(false);
    expect(fieldsOf(r).sort()).toEqual(["confirmPassword", "password"]);
  });

  it("reports a missing password on the password field, and does not also claim a mismatch", () => {
    const r = validateNewPasswordInput({ password: "", confirmPassword: "" });
    expect(r.ok).toBe(false);
    expect(fieldsOf(r)).toEqual(["password"]);
  });

  it("never reports a field outside the unchanged FieldError union", () => {
    const cases = [
      { password: "", confirmPassword: "" },
      { password: "abc", confirmPassword: "abc" },
      { password: "abc", confirmPassword: "zzz" },
      { password: "abcdef", confirmPassword: "" },
    ];
    for (const c of cases) {
      for (const f of fieldsOf(validateNewPasswordInput(c))) expect(ALLOWED_FIELDS).toContain(f);
    }
  });

  it("agrees exactly with validateSignupInput password/confirm verdict for the same pair", () => {
    for (const c of [
      { password: "", confirmPassword: "" },
      { password: "abc", confirmPassword: "abc" },
      { password: "abcde", confirmPassword: "abcde" },
      { password: "abcdef", confirmPassword: "abcdef" },
      { password: "abcdef", confirmPassword: "zzzzzz" },
      { password: "abc", confirmPassword: "zzz" },
    ]) {
      const mine = fieldsOf(validateNewPasswordInput(c)).sort();
      const signup = fieldsOf(validateSignupInput({ email: "a@b.co", ...c }))
        .filter((f) => f !== "email")
        .sort();
      expect(mine, "disagreement on " + JSON.stringify(c)).toEqual(signup);
    }
  });
});

describe("the reuse-do-not-restate requirement, made mechanical", () => {
  const source = readFileSync(join(process.cwd(), "src/lib/domain/auth-validation.ts"), "utf8");

  it("declares exactly one email regex in the whole module", () => {
    const regexLiterals = source.match(/=\s*\/\^.*\$\//g) ?? [];
    expect(regexLiterals, "found: " + JSON.stringify(regexLiterals)).toHaveLength(1);
  });

  it("declares the minimum length exactly once, as MIN_PASSWORD_LENGTH", () => {
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const bareSixes = withoutComments.match(/(?<![\w.])6(?![\w.])/g) ?? [];
    expect(bareSixes, "a second bare 6 means the rule was restated").toHaveLength(1);
    expect(withoutComments).toMatch(/MIN_PASSWORD_LENGTH\s*=\s*6/);
  });

  it("both Phase 8m validators route through the shared helpers, not their own checks", () => {
    const body = source.slice(source.indexOf("export function validateForgotPasswordInput"));
    expect(body).toContain("isValidEmail(");
    expect(body).toContain("isValidPassword(");
  });
});

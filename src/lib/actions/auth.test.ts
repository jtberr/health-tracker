import { beforeEach, describe, expect, it, vi } from "vitest";

const signInWithPassword = vi.fn();
const signUpMock = vi.fn();
const signOutMock = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      signInWithPassword,
      signUp: signUpMock,
      signOut: signOutMock,
    },
  })),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    // next/navigation's redirect() throws internally to unwind the render; mimic that so
    // callers that don't expect code after redirect() to run behave the same way in tests.
    throw new Error(`REDIRECT:${path}`);
  }),
}));

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe("signIn action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns field errors and never calls Supabase when input is invalid", async () => {
    const { signIn } = await import("./auth");
    const result = await signIn(
      { error: null },
      formData({ email: "", password: "" }),
    );

    expect(result.error).toBeTruthy();
    expect(result.fieldErrors?.email).toBeTruthy();
    expect(result.fieldErrors?.password).toBeTruthy();
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("returns the Supabase error message on failed sign-in without redirecting", async () => {
    signInWithPassword.mockResolvedValue({ error: { message: "Invalid login credentials" } });
    const { signIn } = await import("./auth");

    const result = await signIn(
      { error: null },
      formData({ email: "jeff@example.com", password: "wrongpass" }),
    );

    expect(result.error).toBe("Invalid login credentials");
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "jeff@example.com",
      password: "wrongpass",
    });
  });

  it("redirects to / on successful sign-in", async () => {
    signInWithPassword.mockResolvedValue({ error: null });
    const { signIn } = await import("./auth");

    await expect(
      signIn({ error: null }, formData({ email: "jeff@example.com", password: "correctpass" })),
    ).rejects.toThrow("REDIRECT:/");
  });
});

describe("signUp action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns field errors and never calls Supabase when input is invalid", async () => {
    const { signUp } = await import("./auth");
    const result = await signUp(
      { error: null },
      formData({ email: "bad", password: "ab", confirmPassword: "xy" }),
    );

    expect(result.error).toBeTruthy();
    expect(signUpMock).not.toHaveBeenCalled();
  });

  it("returns an info message (not a redirect) on success, per built-in email confirmation", async () => {
    signUpMock.mockResolvedValue({ error: null });
    const { signUp } = await import("./auth");

    const result = await signUp(
      { error: null },
      formData({
        email: "jeff@example.com",
        password: "password1",
        confirmPassword: "password1",
      }),
    );

    expect(result.error).toBeNull();
    expect(result.info).toMatch(/check your email/i);
  });

  it("returns the Supabase error message on failed sign-up", async () => {
    signUpMock.mockResolvedValue({ error: { message: "User already registered" } });
    const { signUp } = await import("./auth");

    const result = await signUp(
      { error: null },
      formData({
        email: "jeff@example.com",
        password: "password1",
        confirmPassword: "password1",
      }),
    );

    expect(result.error).toBe("User already registered");
  });
});

describe("signOut action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls Supabase signOut and redirects to /login", async () => {
    signOutMock.mockResolvedValue({ error: null });
    const { signOut } = await import("./auth");

    await expect(signOut()).rejects.toThrow("REDIRECT:/login");
    expect(signOutMock).toHaveBeenCalled();
  });
});

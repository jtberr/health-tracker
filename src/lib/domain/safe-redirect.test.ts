import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "./safe-redirect";

describe("safeRedirectPath", () => {
  it("allows a normal relative path", () => {
    expect(safeRedirectPath("/dashboard")).toBe("/dashboard");
  });

  it("allows the root path", () => {
    expect(safeRedirectPath("/")).toBe("/");
  });

  it("allows a relative path with query/hash", () => {
    expect(safeRedirectPath("/dashboard?tab=food#top")).toBe("/dashboard?tab=food#top");
  });

  it("rejects a protocol-relative bypass (//evil.com)", () => {
    expect(safeRedirectPath("//evil.com")).toBe("/");
  });

  it("rejects a backslash protocol-relative bypass (/\\evil.com)", () => {
    expect(safeRedirectPath("/\\evil.com")).toBe("/");
  });

  it("rejects an absolute URL", () => {
    expect(safeRedirectPath("https://evil.com")).toBe("/");
  });

  it("rejects a protocol-relative bypass with many leading slashes", () => {
    expect(safeRedirectPath("///evil.com")).toBe("/");
  });

  it("rejects a scheme-relative bypass without www (http)", () => {
    expect(safeRedirectPath("http://evil.com")).toBe("/");
  });

  it("falls back to / when next is missing", () => {
    expect(safeRedirectPath(undefined)).toBe("/");
    expect(safeRedirectPath(null)).toBe("/");
  });

  it("falls back to / when next is empty", () => {
    expect(safeRedirectPath("")).toBe("/");
  });

  it("rejects a path not starting with a slash", () => {
    expect(safeRedirectPath("dashboard")).toBe("/");
  });
});

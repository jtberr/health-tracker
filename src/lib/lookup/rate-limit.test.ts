import { beforeEach, describe, expect, it } from "vitest";
import { _resetLookupRateLimitForTests, isWithinLookupRateLimit } from "./rate-limit";

describe("isWithinLookupRateLimit", () => {
  beforeEach(() => {
    _resetLookupRateLimitForTests();
  });

  it("allows requests up to the per-window limit", () => {
    const now = 1_000_000;
    for (let i = 0; i < 30; i++) {
      expect(isWithinLookupRateLimit("user-a", now + i)).toBe(true);
    }
  });

  it("rejects the request immediately after the limit is reached", () => {
    const now = 1_000_000;
    for (let i = 0; i < 30; i++) {
      isWithinLookupRateLimit("user-a", now + i);
    }
    expect(isWithinLookupRateLimit("user-a", now + 30)).toBe(false);
  });

  it("tracks each user independently", () => {
    const now = 1_000_000;
    for (let i = 0; i < 30; i++) {
      isWithinLookupRateLimit("user-a", now + i);
    }
    // A different user has their own budget, unaffected by user-a's usage.
    expect(isWithinLookupRateLimit("user-b", now)).toBe(true);
  });

  it("allows a request again once the sliding window has passed", () => {
    const now = 1_000_000;
    for (let i = 0; i < 30; i++) {
      isWithinLookupRateLimit("user-a", now + i);
    }
    expect(isWithinLookupRateLimit("user-a", now + 30)).toBe(false);
    // 60_001ms after the first request in the window, that first request has aged out.
    expect(isWithinLookupRateLimit("user-a", now + 60_001)).toBe(true);
  });

  it("prunes old timestamps rather than growing the per-user list unboundedly", () => {
    const now = 1_000_000;
    // Spread 100 requests, one per minute -- none should ever collide within a single window.
    for (let i = 0; i < 100; i++) {
      expect(isWithinLookupRateLimit("user-c", now + i * 60_000)).toBe(true);
    }
  });
});

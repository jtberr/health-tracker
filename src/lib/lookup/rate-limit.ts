/**
 * Simple in-memory, per-user sliding-window rate limiter, applied to `/api/lookup/search`
 * (qa-reviewer N-7) to protect the shared USDA FoodData Central quota (~1000 req/hr across the
 * *whole app*, all users combined -- see ai-context/DECISIONS.md's food-lookup entry). Without
 * this, any single authenticated user could burn through that shared quota alone.
 *
 * Deliberately a v1-appropriate stopgap, not a production-grade distributed rate limiter: state
 * lives in a single process's memory (a plain `Map`), so it does not persist across a serverless
 * cold start and does not coordinate across multiple concurrently-running instances. Both are
 * accepted, documented limitations for this app's actual solo/small-scale usage (see the matching
 * entry added to ai-context/DECISIONS.md) -- a DB- or Redis-backed limiter would coordinate/persist
 * correctly but needs a new table/migration or an external service, which is real added
 * infrastructure this v1 doesn't need yet.
 */

/** The sliding window size. */
const WINDOW_MS = 60_000;

/**
 * Requests allowed per user per window. Chosen generously above any *legitimate* single-user
 * burst (a person searching several foods back-to-back while building one meal) while still
 * meaningfully capping a runaway client/script: even at this app's early solo/small-user scale,
 * a steady 30 req/min from one user for the app's full runtime would still only be a small
 * fraction of USDA's shared ~1000 req/hr allowance.
 */
const MAX_REQUESTS_PER_WINDOW = 30;

const requestTimestamps = new Map<string, number[]>();

/**
 * Records one request attempt for `userId` and reports whether it's within the allowed rate.
 * Prunes timestamps outside the current sliding window on every call, so an intermittently-active
 * user's entry never grows unbounded (a fully idle user's entry is simply never touched again
 * until their next request -- an acceptable characteristic for a small, solo-scale in-memory map).
 */
export function isWithinLookupRateLimit(userId: string, now: number = Date.now()): boolean {
  const windowStart = now - WINDOW_MS;
  const recent = (requestTimestamps.get(userId) ?? []).filter((ts) => ts > windowStart);

  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    requestTimestamps.set(userId, recent);
    return false;
  }

  recent.push(now);
  requestTimestamps.set(userId, recent);
  return true;
}

/** Test-only escape hatch so suites don't leak rate-limit state across test cases. */
export function _resetLookupRateLimitForTests(): void {
  requestTimestamps.clear();
}

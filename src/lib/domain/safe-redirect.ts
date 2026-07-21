/**
 * Pure, framework-free validation for post-auth redirect targets (e.g. the `?next=` query param
 * on `auth/callback`). No Next.js/React/Supabase imports — this is the primary unit-test target
 * per the project conventions (AGENTS.md).
 *
 * Guards against open-redirect: an attacker-controlled `next` value must never be able to send
 * the browser off-origin.
 */

/**
 * Returns `path` if it is a safe, same-origin relative path to redirect to, otherwise `"/"`.
 *
 * A path is safe only if it starts with a single `/` and not `//` (or `/\`) — `//evil.com` (and
 * `/\evil.com`) are protocol-relative URLs that browsers resolve to a *different host*
 * (`evil.com`), even though they pass a naive `startsWith("/")` check. Absolute URLs
 * (`https://evil.com`) are rejected outright since they don't start with `/` at all.
 */
export function safeRedirectPath(path: string | null | undefined): string {
  if (!path) return "/";
  if (!path.startsWith("/")) return "/";
  if (path.startsWith("//") || path.startsWith("/\\")) return "/";
  return path;
}

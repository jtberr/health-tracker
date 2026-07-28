import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";
import { loadEnvConfig } from "@next/env";

// Loads .env.local (same precedence Next.js itself uses) into process.env for the Vitest
// test-runner process, mirroring exactly what playwright.config.ts already does for e2e. Most
// unit tests need no DB at all, but a small number of developer-owned integration tests (e.g.
// src/lib/actions/meals.test.ts) exercise real Server Actions against a real local Supabase
// instance and skip themselves cleanly (`describe.skipIf`) when these vars aren't present — e.g.
// in CI, where the "Unit tests" step deliberately runs BEFORE Supabase is started (see
// .github/workflows/ci.yml), this load is a no-op (no .env.local in CI) and those tests just skip.
//
// Vitest sets NODE_ENV="test" before this config file even runs, and @next/env's loadEnvConfig
// deliberately SKIPS .env.local whenever NODE_ENV is "test" (Next's own documented precedence —
// the rationale being that tests should be deterministic across machines, which doesn't hold for
// this repo's local-Supabase-URL use case). Temporarily presenting NODE_ENV as "development" for
// just this call (then restoring it) is the standard workaround for invoking @next/env outside a
// real Next.js dev/build process while still picking up .env.local — confirmed necessary by
// direct testing (loadEnvConfig silently loaded nothing at all under NODE_ENV="test").
// Cast to a plain mutable record: @types/node types `process.env.NODE_ENV` itself as read-only,
// but this is still an ordinary runtime object property assignment (Node doesn't actually freeze
// it) — this is only working around the type declaration, not any real immutability.
const mutableEnv = process.env as Record<string, string | undefined>;
const originalNodeEnv = mutableEnv.NODE_ENV;
mutableEnv.NODE_ENV = "development";
loadEnvConfig(path.resolve(__dirname));
mutableEnv.NODE_ENV = originalNodeEnv;

/**
 * Builds Vitest's `test.env` object, forwarding only the vars that are ACTUALLY set. Confirmed by
 * direct testing: Vitest coerces every value in `test.env` to a string when it sets it in each
 * worker's `process.env` — so a plain `{ NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL }`
 * where the right-hand side is `undefined` (e.g. no .env.local / Supabase not running) does NOT
 * leave the var unset in the worker; it sets it to the literal three-letter STRING `"undefined"`,
 * which is truthy (`!!"undefined" === true`) and silently defeats any `describe.skipIf(!hasFooEnv)`
 * guard keyed on `!!process.env.NEXT_PUBLIC_SUPABASE_URL`. Omitting unset keys entirely (rather than
 * forwarding `undefined`) is what makes that skip-guard pattern actually work.
 */
function definedEnvOnly(vars: Record<string, string | undefined>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(vars)) {
    if (value !== undefined) result[key] = value;
  }
  return result;
}

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["e2e/**", "node_modules/**"],
    // Test files run in separate worker processes that do NOT automatically inherit
    // process.env mutations made above by loadEnvConfig() in this (the orchestrator) process —
    // `test.env` is Vitest's supported way to explicitly forward specific vars into every worker.
    // Only forwarding the Supabase/site vars the DB-integration tests need (not the whole
    // process.env) keeps this narrow and intentional. See `definedEnvOnly`'s doc comment above for
    // why unset vars must be OMITTED here rather than passed through as `undefined`.
    env: definedEnvOnly({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    }),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});

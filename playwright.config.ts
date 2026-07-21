import path from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { loadEnvConfig } from "@next/env";

/**
 * Acceptance/integration ("test:e2e") config — the design doc's §6 acceptance-test layer.
 *
 * Requires a running local Supabase stack (`npx supabase start`) and the env vars in
 * .env.example (including the server-only SUPABASE_SERVICE_ROLE_KEY, used only by
 * e2e/helpers/* to create/delete auto-confirmed test users via the Supabase admin API — never
 * shipped in the app itself). See README notes / final report for exact setup steps.
 *
 * Next's own dev server (started below via `webServer`) loads `.env.local` automatically, but
 * this config file and e2e/helpers/admin-client.ts run in the Playwright test-runner process
 * itself, which does not inherit that loading. `@next/env` (already a transitive dependency of
 * `next`) is the same loader Next.js uses internally, so this reproduces Next's own env-file
 * precedence (.env.local, .env, etc.) here without adding a new dependency. Not used in CI,
 * where .github/workflows/ci.yml exports the required vars into $GITHUB_ENV for the whole job —
 * loadEnvConfig only fills in vars not already set in the process environment, so it's a no-op
 * there.
 */
loadEnvConfig(path.resolve(__dirname));

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});

import { defineConfig, devices } from "@playwright/test";

/**
 * Acceptance/integration ("test:e2e") config — the design doc's §6 acceptance-test layer.
 *
 * Requires a running local Supabase stack (`npx supabase start`) and the env vars in
 * .env.example (including the server-only SUPABASE_SERVICE_ROLE_KEY, used only by
 * e2e/helpers/* to create/delete auto-confirmed test users via the Supabase admin API — never
 * shipped in the app itself). See README notes / final report for exact setup steps.
 */
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

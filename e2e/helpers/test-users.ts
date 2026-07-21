import { randomUUID } from "node:crypto";
import { createAdminClient } from "./admin-client";

/**
 * Creates a fresh, already-confirmed test user via the Supabase admin API (`auth.admin.createUser`
 * with `email_confirm: true`), so e2e tests can log straight in without needing to click a
 * confirmation-email link. Per docs/architecture/food-weight-tracker.md §8 Phase 1: "Establish the
 * admin-API auto-confirmed test-user helper here (used by all later e2e)."
 *
 * Each call generates a unique email so parallel/repeated test runs never collide on an existing
 * account. Callers are responsible for deleting the user (`deleteTestUser`) in an `afterEach`/
 * `afterAll` — the admin client bypasses RLS, so leftover test users are a cleanup concern, not a
 * security one, but tests should still clean up after themselves.
 */
export type TestUser = { id: string; email: string; password: string };

export async function createConfirmedTestUser(passwordOverride?: string): Promise<TestUser> {
  const admin = createAdminClient();
  const email = `e2e-${randomUUID()}@example.test`;
  const password = passwordOverride ?? `Test-${randomUUID()}`;

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !data.user) {
    throw new Error(`Failed to create e2e test user: ${error?.message ?? "unknown error"}`);
  }

  return { id: data.user.id, email, password };
}

export async function deleteTestUser(userId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    // Non-fatal for the test itself, but surfaced so CI logs show leaked fixtures.
    console.warn(`Failed to delete e2e test user ${userId}: ${error.message}`);
  }
}

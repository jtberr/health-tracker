import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createConfirmedTestUser, deleteTestUser, type TestUser } from "../../../e2e/helpers/test-users";
import { createUserClient } from "../../../e2e/helpers/user-client";
import { createAdminClient } from "../../../e2e/helpers/admin-client";

/**
 * Developer-owned integration test for the qa-reviewer N-1 fix: `src/lib/actions/food.ts`'s
 * `addFoodEntry`/`updateFoodEntry` must reject a garbled/tampered `consumedTz` gracefully (an
 * `{ ok: false, error: "invalid_timezone" }` result), not throw an uncaught `RangeError` that
 * surfaces a generic Next.js error page. See `src/lib/domain/datetime.ts`'s `isValidTimeZone` doc
 * comment and `src/lib/actions/meals.test.ts` (the same fix, applied identically to
 * `logMealForDay`, which is where qa-reviewer originally found this).
 *
 * Same real-Postgres/RLS mocking technique as `meals.test.ts` — see that file's doc comment for
 * the full rationale. Skips cleanly via `describe.skipIf` when a local Supabase instance isn't
 * reachable (e.g. CI's "Unit tests" step, which runs before Supabase is started).
 */

let currentClient: SupabaseClient;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => currentClient,
}));

const hasSupabaseEnv =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
  !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  !!process.env.SUPABASE_SERVICE_ROLE_KEY;

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

describe.skipIf(!hasSupabaseEnv)("food actions (integration, real Postgres/RLS)", () => {
  describe("graceful invalid-timezone handling (qa-reviewer N-1)", () => {
    let user: TestUser;
    let client: SupabaseClient;

    beforeEach(async () => {
      user = await createConfirmedTestUser();
      client = await createUserClient(user);
      currentClient = client;
    });

    afterEach(async () => {
      await deleteTestUser(user.id);
    });

    it("addFoodEntry returns a graceful error (does not throw) for a garbled consumedTz, and writes no rows", async () => {
      const { addFoodEntry } = await import("./food");

      const result = await addFoodEntry(
        { ok: false, error: null },
        formData({
          name: "Garbled Tz Food",
          quantity: "1",
          mode: "total",
          calories: "100",
          protein: "5",
          consumedDate: "2026-01-01",
          consumedTime: "12:00",
          consumedTz: "Not/AZone",
        }),
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("invalid_timezone");

      const admin = createAdminClient();
      const { data } = await admin.from("food_entries").select("*").eq("user_id", user.id);
      expect(data ?? []).toHaveLength(0);
    });

    it("updateFoodEntry returns a graceful error (does not throw) for a garbled consumedTz, and leaves the row untouched", async () => {
      const { addFoodEntry, updateFoodEntry } = await import("./food");

      const created = await addFoodEntry(
        { ok: false, error: null },
        formData({
          name: "Original Name",
          quantity: "1",
          mode: "total",
          calories: "100",
          protein: "5",
          consumedDate: "2026-01-01",
          consumedTime: "12:00",
          consumedTz: "UTC",
        }),
      );
      expect(created.ok).toBe(true);
      const id = created.entry?.id;
      expect(id).toBeTruthy();

      const result = await updateFoodEntry(
        { ok: false, error: null },
        formData({
          id: id ?? "",
          name: "Hijacked Name",
          quantity: "1",
          mode: "total",
          calories: "999",
          protein: "99",
          consumedDate: "2026-01-01",
          consumedTime: "12:00",
          consumedTz: "Not/AZone",
        }),
      );

      expect(result.ok).toBe(false);
      expect(result.error).toBe("invalid_timezone");

      const admin = createAdminClient();
      const { data } = await admin.from("food_entries").select("*").eq("id", id ?? "").single();
      expect((data as { name: string }).name).toBe("Original Name");
    });
  });
});

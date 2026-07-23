-- Local dev / test seed data.
--
-- Two confirmed users ("alice" and "bob"), each with fixture rows across all five tables, so
-- Phase 2's RLS isolation and constraints can be inspected directly (e.g. in Studio) and so local
-- dev/qa-reviewer have realistic cross-user data from the start. See
-- docs/architecture/food-weight-tracker.md §8 Phase 2 and ai-context/DECISIONS.md.
--
-- This runs via `supabase db reset` / `supabase start` as the Postgres superuser, which bypasses
-- RLS entirely (RLS governs the anon/authenticated Data API roles, not direct superuser access) —
-- so it's fine to insert rows for two different users' data in one script here, unlike the app
-- itself which always scopes writes to the current session's auth.uid().
--
-- Both users authenticate with password "password123" (local dev only — never a real secret) so
-- they can also be used to log in through the app UI for manual testing, not just direct queries.
-- Inserting directly into auth.users/auth.identities (rather than going through the Auth API) is
-- the standard local-Postgres seeding pattern documented by Supabase, since this seed script has
-- full schema access that the Data API roles don't.

-- --- Two auth users (Supabase Auth's own tables — bypasses the Auth API for seeding only) -----

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  is_sso_user, is_anonymous
) values
  (
    '00000000-0000-0000-0000-000000000000',
    '11111111-1111-1111-1111-111111111111',
    'authenticated', 'authenticated', 'alice@example.test',
    extensions.crypt('password123', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', '', false, false
  ),
  (
    '00000000-0000-0000-0000-000000000000',
    '22222222-2222-2222-2222-222222222222',
    'authenticated', 'authenticated', 'bob@example.test',
    extensions.crypt('password123', extensions.gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
    '', '', '', '', false, false
  );

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values
  (
    gen_random_uuid(), '11111111-1111-1111-1111-111111111111',
    '11111111-1111-1111-1111-111111111111',
    '{"sub":"11111111-1111-1111-1111-111111111111","email":"alice@example.test"}'::jsonb,
    'email', now(), now(), now()
  ),
  (
    gen_random_uuid(), '22222222-2222-2222-2222-222222222222',
    '22222222-2222-2222-2222-222222222222',
    '{"sub":"22222222-2222-2222-2222-222222222222","email":"bob@example.test"}'::jsonb,
    'email', now(), now(), now()
  );

-- --- Saved meals (alice only, to show an empty-state for bob) -----------------------------------

insert into public.meals (id, user_id, name) values
  ('a1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'Breakfast staple');

insert into public.meal_items
  (meal_id, user_id, name, quantity, unit, calories_per_unit, protein_g_per_unit, sort_order)
values
  ('a1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Egg', 3, 'egg', 70, 6, 0),
  ('a1111111-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Toast', 2, 'slice', 90, 3, 1);

-- --- Food entries (both users, today + yesterday, incl. two entries sharing one consumed_at so
-- the future Phase 3 exact-timestamp grouping has a real fixture to group) -----------------------

insert into public.food_entries
  (user_id, name, quantity, unit, calories_per_unit, protein_g_per_unit, consumed_at, consumed_tz)
values
  -- alice: two items logged in the same sitting today (same consumed_at -> one meal group later)
  ('11111111-1111-1111-1111-111111111111', 'Chicken breast', 1, 'serving', 165, 31,
   date_trunc('hour', now()), 'America/New_York'),
  ('11111111-1111-1111-1111-111111111111', 'Rice', 1, 'cup', 205, 4.3,
   date_trunc('hour', now()), 'America/New_York'),
  -- alice: yesterday, a separate instant
  ('11111111-1111-1111-1111-111111111111', 'Protein shake', 1, 'shake', 120, 25,
   date_trunc('hour', now()) - interval '1 day', 'America/New_York'),
  -- bob: today, a single entry
  ('22222222-2222-2222-2222-222222222222', 'Oatmeal', 1, 'bowl', 300, 10,
   date_trunc('hour', now()), 'Europe/London');

-- --- Daily metrics (both users, today) -----------------------------------------------------------

insert into public.daily_metrics (user_id, metric_date, weight_kg, body_fat_pct) values
  ('11111111-1111-1111-1111-111111111111', current_date, 68.20, 22.5),
  ('22222222-2222-2222-2222-222222222222', current_date, 82.50, null);

-- --- Goals (alice only, to show an unset/default state for bob) ---------------------------------

insert into public.user_goals (user_id, daily_calorie_target, daily_protein_target_g, weight_unit)
values
  ('11111111-1111-1111-1111-111111111111', 2000, 150, 'lb');

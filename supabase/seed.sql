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

-- --- Third seeded account: bodine990@gmail.com, with ~90 days of realistic food/weight history --
--
-- Jeff's own email, so it's a stable, memorable login across every `supabase db reset` — but the
-- password below ("password123", same disposable local-dev convention as alice/bob above) is
-- NOT Jeff's real account password. Never put a real, reusable password in a file that's
-- committed to git and pushed to GitHub, even for a "local dev only" seed script — Jeff confirmed
-- this tradeoff explicitly (2026-07-26) rather than using his actual password here.

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  is_sso_user, is_anonymous
) values (
  '00000000-0000-0000-0000-000000000000',
  '33333333-3333-3333-3333-333333333333',
  'authenticated', 'authenticated', 'bodine990@gmail.com',
  extensions.crypt('password123', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, now(), now(),
  '', '', '', '', false, false
);

insert into auth.identities (
  id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(), '33333333-3333-3333-3333-333333333333',
  '33333333-3333-3333-3333-333333333333',
  '{"sub":"33333333-3333-3333-3333-333333333333","email":"bodine990@gmail.com"}'::jsonb,
  'email', now(), now(), now()
);

insert into public.user_goals (user_id, daily_calorie_target, daily_protein_target_g, weight_unit)
values
  ('33333333-3333-3333-3333-333333333333', 2200, 160, 'lb');

-- 90 days of weight/body-fat: a gentle downward trend (~86kg -> ~82kg) with small day-to-day
-- noise (sin-based, so it's deterministic and reproducible across every reset rather than using
-- random()). body_fat_pct is skipped every 5th day to mimic a real "weight logged more often than
-- body fat" habit, matching the schema's "weight-only day" case (ai-context/DECISIONS.md).
--
-- IMPORTANT (fixed 2026-07-27, see ai-context/PROGRESS.md for the root-cause writeup): the anchor
-- for "today" below is deliberately (now() at time zone 'America/Chicago')::date, NOT the bare
-- current_date. Postgres's current_date is evaluated in the *session's* TimeZone (UTC on this
-- Docker image, confirmed via `show timezone`), not in this seed's chosen America/Chicago zone.
-- Every day, for the ~5-6 hours between UTC midnight and America/Chicago's own midnight, UTC's
-- current_date is one calendar day ahead of Chicago's real current date. Using the bare
-- current_date as the food_entries anchor (below) generated a day_offset=0 row dated one day
-- into Chicago's future during exactly that window, which trips food_entries_not_future_day (its
-- CHECK compares against `(now() at time zone consumed_tz)::date` — the *real* Chicago date, not
-- session current_date) and made `supabase db reset` intermittently fail depending on real
-- wall-clock time. Anchoring on the same now()-derived Chicago date here too (even though
-- daily_metrics' looser `metric_date <= current_date + 1` check never actually failed from this)
-- keeps one consistent, correct notion of "today" across both generators below.
insert into public.daily_metrics (user_id, metric_date, weight_kg, body_fat_pct)
select
  '33333333-3333-3333-3333-333333333333',
  (now() at time zone 'America/Chicago')::date - d.day_offset,
  round((86.0 - (89 - d.day_offset) * 0.044 + sin(d.day_offset * 0.7) * 0.4)::numeric, 2),
  case when d.day_offset % 5 = 0 then null
       else round((24.0 - (89 - d.day_offset) * 0.02 + sin(d.day_offset * 0.5) * 0.3)::numeric, 1)
  end
from generate_series(0, 89) as d(day_offset);

-- 90 days of food entries: breakfast/lunch/snack/dinner, each rotating through a small pool of
-- realistic foods (real names + plausible calorie/protein values, not placeholder/gibberish text)
-- so day-to-day totals vary naturally instead of repeating the exact same items every day.
with pools as (
  select * from (values
    ('breakfast', 0, 'Scrambled eggs (2)', 180::numeric, 12::numeric),
    ('breakfast', 1, 'Oatmeal with banana', 310, 8),
    ('breakfast', 2, 'Greek yogurt with berries', 220, 18),
    ('breakfast', 3, 'Avocado toast', 280, 7),
    ('breakfast', 4, 'Protein pancakes', 350, 24),
    ('lunch', 0, 'Turkey sandwich', 380, 26),
    ('lunch', 1, 'Chicken Caesar salad', 420, 35),
    ('lunch', 2, 'Grilled chicken with rice', 520, 45),
    ('lunch', 3, 'Tuna salad wrap', 400, 30),
    ('lunch', 4, 'Veggie burrito bowl', 460, 20),
    ('snack', 0, 'Protein shake', 160, 25),
    ('snack', 1, 'Almonds (1 oz)', 165, 6),
    ('snack', 2, 'Apple', 95, 0.5),
    ('snack', 3, 'Cottage cheese', 120, 14),
    ('dinner', 0, 'Salmon with roasted vegetables', 480, 38),
    ('dinner', 1, 'Grilled steak with sweet potato', 560, 42),
    ('dinner', 2, 'Spaghetti with meat sauce', 620, 28),
    ('dinner', 3, 'Stir-fry chicken and vegetables', 440, 36),
    ('dinner', 4, 'Baked cod with quinoa', 400, 34)
  ) as t(slot, idx, name, kcal, protein)
),
slots as (
  select * from (values
    ('breakfast', '07:30', 5),
    ('lunch', '12:30', 5),
    ('snack', '15:30', 4),
    ('dinner', '18:30', 5)
  ) as t(slot, time_of_day, pool_size)
),
days as (
  select day_offset from generate_series(0, 89) as g(day_offset)
)
-- Anchor "today" on Chicago's own real current date (derived from now(), the same instant the
-- food_entries_not_future_day CHECK constraint itself uses via `now() at time zone consumed_tz`),
-- NOT the bare current_date, which is evaluated in the session's TimeZone (UTC here) and can be
-- a full day ahead of Chicago's actual date for several hours after every UTC midnight. See the
-- comment above the daily_metrics generator for the full root-cause writeup.
insert into public.food_entries
  (user_id, name, quantity, calories_per_unit, protein_g_per_unit, consumed_at, consumed_tz)
select
  '33333333-3333-3333-3333-333333333333',
  p.name,
  1,
  p.kcal,
  p.protein,
  ((((now() at time zone 'America/Chicago')::date - days.day_offset)::text || ' ' || s.time_of_day)::timestamp)
    at time zone 'America/Chicago',
  'America/Chicago'
from days
cross join slots s
join pools p on p.slot = s.slot and p.idx = days.day_offset % s.pool_size;

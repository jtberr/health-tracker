-- Food, Weight & Body-Fat Tracker — core schema (Phase 2: Data model + RLS)
--
-- Single, FK-ordered, greenfield migration per docs/architecture/food-weight-tracker.md §3.2/§8
-- Phase 2 and ai-context/DECISIONS.md. Creates all five tables, the `daily_food_totals` view,
-- every trigger/constraint, and four-policy `user_id = (select auth.uid())` RLS on every table. No
-- backfill (greenfield).
--
-- Table order resolves FKs: meals -> meal_items (+ food_entries.logged_from_meal_id) ->
-- food_entries -> daily_metrics -> user_goals -> daily_food_totals view.
--
-- Privilege note: this project's supabase/config.toml does NOT set the legacy
-- `auto_expose_new_tables = true`, so new relations created here are NOT reachable via the
-- Data API until explicitly GRANTed (confirmed against the running local instance: the `public`
-- schema's default ACL for role `postgres` grants `anon`/`authenticated`/`service_role` only
-- TRUNCATE/REFERENCES/TRIGGER/MAINTAIN on new tables, not SELECT/INSERT/UPDATE/DELETE). Every
-- table below therefore gets an explicit GRANT to `authenticated` (the role Data API requests run
-- as once a user is logged in) and `service_role` (bypasses RLS via its `bypassrls` role
-- attribute, but still needs the base SQL privilege — used only by trusted server-only contexts
-- per AGENTS.md). Nothing is granted to `anon` — every table requires authentication.
--
-- RLS policy note: every policy below wraps `auth.uid()` as `(select auth.uid())`. This is
-- Supabase's documented RLS performance pattern — it lets Postgres evaluate the call once per
-- query (an InitPlan) instead of once per row — and was confirmed by running
-- `supabase db advisors --local` against this migration, which otherwise flags every policy with
-- the `auth_rls_initplan` performance warning. No change in behavior, only in query plan.

-- ---------------------------------------------------------------------------------------------
-- Shared trigger functions
-- ---------------------------------------------------------------------------------------------

-- Generic `updated_at` bump, reused by every table below.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Derives food_entries.consumed_local_date from consumed_at (UTC instant) + consumed_tz (IANA
-- zone), per ai-context/DECISIONS.md "Food-entry timestamps stored in UTC with per-entry
-- timezone capture". `timezone(text, timestamptz)` is STABLE, not IMMUTABLE, so it cannot back a
-- generated column or index directly (documented in that decision) — this BEFORE trigger
-- persists the derived value instead, which is what keeps grouping/totals indexable and stable
-- even if the user later travels to a different timezone. Runs on INSERT unconditionally, and on
-- UPDATE only when consumed_at or consumed_tz actually change. Always overwrites whatever the
-- client may have sent for consumed_local_date — it is a derived value, never client-authoritative.
create or replace function public.set_consumed_local_date()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.consumed_local_date := (new.consumed_at at time zone new.consumed_tz)::date;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------
-- meals
-- ---------------------------------------------------------------------------------------------

create table public.meals (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null check (btrim(name) <> ''),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Required as the FK target for meal_items' composite (meal_id, user_id) FK below, which is
  -- what enforces that a meal_item's user_id always matches its parent meal's owner.
  constraint meals_id_user_id_key unique (id, user_id)
);

create index meals_user_id_idx on public.meals (user_id);

create trigger meals_set_updated_at
  before update on public.meals
  for each row execute function public.set_updated_at();

alter table public.meals enable row level security;

create policy meals_select_own on public.meals
  for select using (user_id = (select auth.uid()));
create policy meals_insert_own on public.meals
  for insert with check (user_id = (select auth.uid()));
create policy meals_update_own on public.meals
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy meals_delete_own on public.meals
  for delete using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.meals to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- meal_items — per-meal items, scoped to their meal only (no shared cross-meal food library;
-- see ai-context/DECISIONS.md "Saved meals: items scoped per-meal ..."). Quantity/unit/per-unit
-- with STORED generated totals, per "Quantity + unit as first-class fields ...".
-- ---------------------------------------------------------------------------------------------

create table public.meal_items (
  id                    uuid primary key default gen_random_uuid(),
  meal_id               uuid not null,
  user_id               uuid not null references auth.users(id) on delete cascade,
  name                  text not null check (btrim(name) <> ''),
  quantity              numeric(10, 3) not null default 1 check (quantity > 0),
  unit                  text,
  calories_per_unit     numeric(10, 2) not null check (calories_per_unit >= 0),
  protein_g_per_unit    numeric(10, 2) not null check (protein_g_per_unit >= 0),
  calories              integer generated always as (round(quantity * calories_per_unit)) stored,
  protein_g             numeric(6, 2)
    generated always as (round((quantity * protein_g_per_unit)::numeric, 2)) stored,
  -- Persists user-controlled item order within a meal ("add/edit/remove/reorder items", §2/§8
  -- Phase 7). Not called out by name in the design doc's §3.2 column summary, but reordering
  -- needs somewhere to persist — adding it now avoids a Phase 7 migration for it. Flagged as a
  -- deviation in the implementation report.
  sort_order            integer not null default 0 check (sort_order >= 0),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- Composite FK to meals(id, user_id): guarantees a meal_item's user_id always matches its
  -- parent meal's owner (the "cross-user meal_item" integrity check called out in §8 Phase 2).
  constraint meal_items_meal_user_fkey
    foreign key (meal_id, user_id) references public.meals (id, user_id) on delete cascade
);

create index meal_items_meal_id_sort_idx on public.meal_items (meal_id, sort_order);

create trigger meal_items_set_updated_at
  before update on public.meal_items
  for each row execute function public.set_updated_at();

alter table public.meal_items enable row level security;

create policy meal_items_select_own on public.meal_items
  for select using (user_id = (select auth.uid()));
create policy meal_items_insert_own on public.meal_items
  for insert with check (user_id = (select auth.uid()));
create policy meal_items_update_own on public.meal_items
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy meal_items_delete_own on public.meal_items
  for delete using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.meal_items to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- food_entries — one row per logged food item. UTC consumed_at + per-entry consumed_tz +
-- trigger-derived consumed_local_date; STORED generated totals; no-future-day CHECK.
-- ---------------------------------------------------------------------------------------------

create table public.food_entries (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null references auth.users(id) on delete cascade,
  name                    text not null check (btrim(name) <> ''),
  quantity                numeric(10, 3) not null default 1 check (quantity > 0),
  unit                    text,
  calories_per_unit       numeric(10, 2) not null check (calories_per_unit >= 0),
  protein_g_per_unit      numeric(10, 2) not null check (protein_g_per_unit >= 0),
  calories                integer generated always as (round(quantity * calories_per_unit)) stored,
  protein_g               numeric(6, 2)
    generated always as (round((quantity * protein_g_per_unit)::numeric, 2)) stored,
  consumed_at             timestamptz not null,
  consumed_tz             text not null check (btrim(consumed_tz) <> ''),
  -- Set by the set_consumed_local_date trigger below; never written directly by app code.
  consumed_local_date     date not null,
  logged_from_meal_id     uuid references public.meals(id) on delete set null,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  -- No logging into the future, capped at the *local day* in the entry's own timezone — see
  -- ai-context/DECISIONS.md "No logging into the future ...". `now()` and timezone math are
  -- STABLE, which is fine in a CHECK constraint (only generated columns/indexes require
  -- IMMUTABLE — the reason consumed_local_date needed a trigger instead of a generated column).
  constraint food_entries_not_future_day
    check (consumed_local_date <= (now() at time zone consumed_tz)::date)
);

create index food_entries_user_local_date_idx
  on public.food_entries (user_id, consumed_local_date, consumed_at);
create index food_entries_logged_from_meal_idx
  on public.food_entries (logged_from_meal_id)
  where logged_from_meal_id is not null;

create trigger food_entries_set_consumed_local_date
  before insert or update of consumed_at, consumed_tz on public.food_entries
  for each row execute function public.set_consumed_local_date();

create trigger food_entries_set_updated_at
  before update on public.food_entries
  for each row execute function public.set_updated_at();

alter table public.food_entries enable row level security;

create policy food_entries_select_own on public.food_entries
  for select using (user_id = (select auth.uid()));
create policy food_entries_insert_own on public.food_entries
  for insert with check (user_id = (select auth.uid()));
create policy food_entries_update_own on public.food_entries
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy food_entries_delete_own on public.food_entries
  for delete using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.food_entries to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- daily_metrics — one row per user per day, weight required / body fat optional (upsert
-- overwrites). Weight always stored canonically in kg; see ai-context/DECISIONS.md.
-- ---------------------------------------------------------------------------------------------

create table public.daily_metrics (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  metric_date     date not null,
  weight_kg       numeric(5, 2) not null check (weight_kg > 0),
  body_fat_pct    numeric(4, 1) check (body_fat_pct is null or (body_fat_pct >= 0 and body_fat_pct <= 100)),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint daily_metrics_user_date_key unique (user_id, metric_date),

  -- Deliberately loose (current_date + 1, not tz-aware) — daily_metrics has no per-row timezone
  -- unlike food_entries, so a tight same-day check in server UTC could spuriously reject a
  -- legitimate "today" entry for users ahead of UTC near midnight. Precise enforcement happens
  -- client-side / in the server action (metricTz), per ai-context/DECISIONS.md
  -- "No logging into the future ...".
  constraint daily_metrics_not_future_day check (metric_date <= (current_date + 1))
);

create trigger daily_metrics_set_updated_at
  before update on public.daily_metrics
  for each row execute function public.set_updated_at();

alter table public.daily_metrics enable row level security;

create policy daily_metrics_select_own on public.daily_metrics
  for select using (user_id = (select auth.uid()));
create policy daily_metrics_insert_own on public.daily_metrics
  for insert with check (user_id = (select auth.uid()));
create policy daily_metrics_update_own on public.daily_metrics
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy daily_metrics_delete_own on public.daily_metrics
  for delete using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.daily_metrics to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- user_goals — single current goal per user (no history); weight_unit is the "unit enum" called
-- out in §8 Phase 2 (kg/lb display+input preference; storage is always kg regardless — see
-- ai-context/DECISIONS.md "Weight stored canonically in kg ..."). One row per user: user_id is
-- itself the primary key (standard 1:1 "settings row" shape), matching the "ensure-row" access
-- pattern the design doc describes for getGoals/updateGoals.
-- ---------------------------------------------------------------------------------------------

create table public.user_goals (
  user_id                     uuid primary key references auth.users(id) on delete cascade,
  daily_calorie_target        integer check (daily_calorie_target is null or daily_calorie_target >= 0),
  daily_protein_target_g      numeric(6, 2) check (daily_protein_target_g is null or daily_protein_target_g >= 0),
  weight_unit                 text not null default 'kg' check (weight_unit in ('kg', 'lb')),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create trigger user_goals_set_updated_at
  before update on public.user_goals
  for each row execute function public.set_updated_at();

alter table public.user_goals enable row level security;

create policy user_goals_select_own on public.user_goals
  for select using (user_id = (select auth.uid()));
create policy user_goals_insert_own on public.user_goals
  for insert with check (user_id = (select auth.uid()));
create policy user_goals_update_own on public.user_goals
  for update using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy user_goals_delete_own on public.user_goals
  for delete using (user_id = (select auth.uid()));

grant select, insert, update, delete on public.user_goals to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- daily_food_totals — per-user, per-local-day sums of the generated calories/protein_g columns.
-- `security_invoker = true` is required: without it, a view runs with its OWNER's privileges/RLS
-- context (effectively bypassing RLS, since the owner here is a bypassrls role) rather than the
-- querying user's — this is what makes the view's own row-visibility inherit food_entries' RLS.
-- No policies are defined ON the view itself (views aren't RLS targets); the GRANT below is the
-- Data API exposure step, and security_invoker is what keeps that safe per-user.
-- ---------------------------------------------------------------------------------------------

create view public.daily_food_totals
with (security_invoker = true) as
select
  user_id,
  consumed_local_date,
  sum(calories)::integer as total_calories,
  sum(protein_g)::numeric(9, 2) as total_protein_g,
  count(*)::integer as entry_count
from public.food_entries
group by user_id, consumed_local_date;

grant select on public.daily_food_totals to authenticated, service_role;

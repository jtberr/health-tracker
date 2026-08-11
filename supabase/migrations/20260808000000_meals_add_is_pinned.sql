-- Phase 8f -- "Saved meals: pinning and duplicating".
--
-- One column, no new table, no backfill, no index, and (per design doc §3.2/§3.3) no new RLS
-- policy: `meals` RLS is already enabled with all four `user_id = (select auth.uid())` policies
-- and a table-level `authenticated` grant (see the Phase 2 migration), so a plain ALTER on this
-- existing table is covered by both the moment the column exists -- `meals_update_own` already
-- constrains any `is_pinned` update to rows the caller owns on both `using` and `with check`.
--
-- qa-reviewer must verify this by QUERYING the policies after this migration runs, not by reading
-- this comment (docs/architecture/food-weight-tracker.md §3.2/§6 "Pinned meals and duplicating a
-- meal" -- "verify by query, not by reading the SQL").
--
-- `not null default false` fills every pre-existing row in the same statement -- no separate
-- backfill step needed. A partial index (`where is_pinned`) is deliberately NOT added -- the
-- pinned/unpinned split happens client-side in `sortMealsByName`, and the underlying read is
-- already a full RLS-scoped scan of tens of rows (see ai-context/DECISIONS.md's "Pinned saved
-- meals add the first column since Phase 2..." entry for the full reasoning, including why this
-- is a boolean rather than a `pinned_at timestamptz`).
alter table public.meals
  add column is_pinned boolean not null default false;

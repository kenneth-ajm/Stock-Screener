-- Strategy tabs + strategy-tagged positions + time-stop metadata
-- Run in Supabase SQL editor.

begin;

-- 1) Allow daily_scans rows per strategy version (same symbol/date/universe).
-- If you already have a unique index/constraint on (date, universe_slug, symbol),
-- replace it with one that includes strategy_version.
do $$
begin
  if exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and indexname = 'daily_scans_date_universe_slug_symbol_key'
  ) then
    execute 'drop index if exists public.daily_scans_date_universe_slug_symbol_key';
  end if;
exception when others then
  -- no-op if index name differs
  null;
end $$;

create unique index if not exists daily_scans_date_universe_strategy_symbol_uniq
  on public.daily_scans (date, universe_slug, strategy_version, symbol);

-- 2) Tag positions with strategy + time-stop metadata.
alter table public.portfolio_positions
  add column if not exists strategy_version text not null default 'v2_core_momentum',
  add column if not exists max_hold_days integer,
  add column if not exists tp_model text;

commit;


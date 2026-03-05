-- Scan engine pipeline schema alignment

alter table public.daily_scans
  add column if not exists rank_score numeric,
  add column if not exists rank integer;

-- Drop legacy unique indexes that do not include strategy_version
-- (names may vary across environments; keep these safe and idempotent)
drop index if exists public.daily_scans_date_universe_slug_symbol_key;
drop index if exists public.uq_daily_scans_date_universe_symbol;
drop index if exists public.idx_daily_scans_unique_old;

-- Ensure conflict target supports (date, universe_slug, symbol, strategy_version)
create unique index if not exists uq_daily_scans_date_universe_symbol_strategy
  on public.daily_scans (date, universe_slug, symbol, strategy_version);

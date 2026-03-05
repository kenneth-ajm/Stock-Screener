-- Optional metadata for regime freshness/audit.
alter table if exists public.market_regime
  add column if not exists updated_at timestamptz null;

alter table if exists public.market_regime
  add column if not exists source text null;


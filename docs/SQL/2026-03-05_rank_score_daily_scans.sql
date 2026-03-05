-- Ranking fields for screener ordering
alter table public.daily_scans
  add column if not exists rank_score numeric,
  add column if not exists rank integer;

-- Optional helper index for faster ordered reads on latest scans
create index if not exists idx_daily_scans_rank
  on public.daily_scans (date desc, universe_slug, strategy_version, signal, rank_score desc, confidence desc, symbol asc);

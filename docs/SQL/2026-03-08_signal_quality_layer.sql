-- Signal Quality Layer storage (cached in daily_scans)
alter table public.daily_scans
  add column if not exists quality_score numeric,
  add column if not exists quality_components jsonb,
  add column if not exists risk_grade text,
  add column if not exists quality_summary text,
  add column if not exists quality_signal text;

create index if not exists idx_daily_scans_quality
  on public.daily_scans (date desc, universe_slug, strategy_version, quality_score desc nulls last, symbol asc);

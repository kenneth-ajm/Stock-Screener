-- Persist source scan context for paper trades opened from Ideas.
-- Safe additive change for existing deployments.

alter table if exists public.paper_positions
  add column if not exists universe_slug text null;

alter table if exists public.paper_positions
  add column if not exists source_scan_date date null;

create index if not exists idx_paper_positions_user_strategy_universe
  on public.paper_positions (user_id, strategy_version, universe_slug);

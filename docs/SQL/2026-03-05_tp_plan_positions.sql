-- TP intention plan fields for portfolio positions.
-- Run in Supabase SQL editor.

begin;

alter table public.portfolio_positions
  add column if not exists tp_plan text,
  add column if not exists tp1_pct numeric,
  add column if not exists tp2_pct numeric,
  add column if not exists tp1_size_pct integer,
  add column if not exists tp2_size_pct integer;

commit;


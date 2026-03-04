-- Trading fee support (entry/exit) and optional portfolio default fee.
-- Run in Supabase SQL editor.

begin;

alter table public.portfolio_positions
  add column if not exists entry_fee numeric,
  add column if not exists exit_fee numeric;

alter table public.portfolios
  add column if not exists default_fee_per_order numeric;

commit;


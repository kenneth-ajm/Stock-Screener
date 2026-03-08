-- Paper execution positions table (platform-only simulation).
-- Read-only broker integration remains separate.
-- Run in Supabase SQL editor.

create table if not exists public.paper_positions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  portfolio_id uuid null references public.portfolios(id) on delete set null,
  symbol text not null,
  strategy_version text not null,
  entry_price numeric not null,
  stop_price numeric not null,
  tp1 numeric null,
  tp2 numeric null,
  shares integer not null,
  status text not null default 'OPEN',
  reason_summary text null,
  notes text null,
  exit_price numeric null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint paper_positions_status_check check (status in ('PENDING','OPEN','CLOSED','STOPPED','TP1_HIT','TP2_HIT'))
);

create index if not exists idx_paper_positions_user_status_opened
  on public.paper_positions (user_id, status, opened_at desc);

create index if not exists idx_paper_positions_user_symbol
  on public.paper_positions (user_id, symbol);


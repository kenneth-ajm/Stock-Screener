-- Broker/system snapshot persistence table (minimal).
-- Run in Supabase SQL Editor for the target project.

create table if not exists public.system_status (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Optional index for updated status views.
create index if not exists idx_system_status_updated_at
  on public.system_status (updated_at desc);


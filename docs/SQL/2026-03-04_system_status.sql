-- System status storage for autopilot health
-- Run in Supabase SQL editor.

create table if not exists public.system_status (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);


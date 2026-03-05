-- Add explicit cash tracking fields to portfolios for accurate screener capacity.
alter table if exists public.portfolios
  add column if not exists cash_balance numeric null;

alter table if exists public.portfolios
  add column if not exists cash_updated_at timestamptz null;


-- Outcomes tracking v1 for closed-position analytics.
-- Run in Supabase SQL editor.

begin;

alter table public.portfolio_positions
  add column if not exists exit_date date,
  add column if not exists exit_reason text,
  add column if not exists mfe numeric,
  add column if not exists mae numeric;

-- Ensure status has a default and valid values.
alter table public.portfolio_positions
  alter column status set default 'OPEN';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'portfolio_positions_status_check'
  ) then
    alter table public.portfolio_positions
      add constraint portfolio_positions_status_check
      check (status in ('OPEN', 'CLOSED'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'portfolio_positions_exit_reason_check'
  ) then
    alter table public.portfolio_positions
      add constraint portfolio_positions_exit_reason_check
      check (
        exit_reason is null
        or exit_reason in ('TP1', 'TP2', 'STOP', 'MANUAL', 'TIME')
      );
  end if;
end $$;

commit;

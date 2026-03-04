-- Normalize TP plan values to the supported set and add a guard constraint.
-- Run in Supabase SQL editor.

begin;

update public.portfolio_positions
set tp_plan =
  case
    when lower(coalesce(tp_plan, '')) in ('tp1_only', 'tp1only') then 'tp1_only'
    when lower(coalesce(tp_plan, '')) in ('tp1_tp2', 'tp1+tp2', 'tp1tp2') then 'tp1_tp2'
    else 'none'
  end
where tp_plan is null
   or lower(tp_plan) not in ('none', 'tp1_only', 'tp1_tp2');

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'portfolio_positions_tp_plan_check'
  ) then
    alter table public.portfolio_positions
      add constraint portfolio_positions_tp_plan_check
      check (tp_plan is null or tp_plan in ('none', 'tp1_only', 'tp1_tp2'));
  end if;
end $$;

commit;


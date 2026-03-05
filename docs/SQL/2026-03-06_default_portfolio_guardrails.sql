-- Ensure canonical active portfolio fields exist
alter table if exists portfolios
  add column if not exists user_id uuid;

alter table if exists portfolios
  add column if not exists is_default boolean not null default false;

-- Enforce at most one default portfolio per user
create unique index if not exists portfolios_one_default_per_user_idx
  on portfolios (user_id)
  where is_default = true and user_id is not null;

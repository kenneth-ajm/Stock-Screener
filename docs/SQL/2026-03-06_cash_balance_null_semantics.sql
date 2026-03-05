-- Make manual cash override opt-in only; NULL means "not set".
alter table if exists portfolios
  alter column cash_balance drop default;

-- Optional one-time repair if legacy rows were implicitly set to 0.
-- Run only if you want to treat untouched zero values as unknown.
-- update portfolios
-- set cash_balance = null
-- where cash_balance = 0 and cash_updated_at is null;

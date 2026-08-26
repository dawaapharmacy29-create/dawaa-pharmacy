-- Apply only after the safe advanced tools are live on production.
-- The branch-aware unique index uq_customer_cashback_accounts_branch_code already exists.
drop index if exists public.uq_customer_cashback_accounts_code;

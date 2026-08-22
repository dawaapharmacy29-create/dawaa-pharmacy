-- Dashboard/login performance hardening — 2026-08-22
-- Safe additive indexes only. No data changes and no existing constraint replacement.
-- These match the most frequent filters used by the executive dashboard and customer follow-up counters.

create index if not exists idx_sales_invoices_invoice_date_branch
  on public.sales_invoices (invoice_date desc, branch);

create index if not exists idx_sales_invoices_branch_invoice_date
  on public.sales_invoices (branch, invoice_date desc);

create index if not exists idx_sales_invoices_seller_date
  on public.sales_invoices (seller_name, invoice_date desc)
  where seller_name is not null;

create index if not exists idx_daily_followups_date_branch
  on public.daily_followups (followup_date desc, branch);

create index if not exists idx_daily_followups_branch_date_open
  on public.daily_followups (branch, followup_date desc)
  where coalesce(is_hidden, false) = false;

create index if not exists idx_daily_followups_created_at
  on public.daily_followups (created_at desc);

create index if not exists idx_activity_log_created_at
  on public.activity_log (created_at desc);

create index if not exists idx_activity_log_user_created_at
  on public.activity_log (user_id, created_at desc)
  where user_id is not null;

comment on index public.idx_sales_invoices_invoice_date_branch is
  'Speeds dashboard date-range scans and branch grouping.';

comment on index public.idx_daily_followups_date_branch is
  'Speeds dashboard customer-service counters and due follow-up queries.';

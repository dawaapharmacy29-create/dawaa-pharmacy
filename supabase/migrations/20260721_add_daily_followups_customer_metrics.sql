alter table public.daily_followups
  add column if not exists customer_metrics jsonb not null default '{}'::jsonb;

comment on column public.daily_followups.customer_metrics is
  'Optional cached customer metrics used by compact follow-up filters. Source-of-truth customer data remains in customer/customer metrics views.';

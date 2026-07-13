-- Non-destructive customer data foundation.
-- This migration does not update, delete, merge, or overwrite existing customers.

create or replace function public.normalize_customer_code_v2(value text)
returns text
language sql
immutable
as $$
  select case
    when cleaned is null or cleaned = '' or cleaned = '.' then null
    when cleaned ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then null
    else regexp_replace(cleaned, '\.0+$', '')
  end
  from (
    select nullif(
      btrim(
        regexp_replace(
          translate(regexp_replace(coalesce(value, ''), '^code:', '', 'i'), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
          '\s+', '', 'g'
        )
      ),
      ''
    ) as cleaned
  ) normalized;
$$;

create or replace function public.classify_customer_avg_monthly_v2(avg_monthly numeric)
returns text
language sql
immutable
as $$
  select case
    when greatest(coalesce(avg_monthly, 0), 0) > 8000 then 'مهم جدًا'
    when greatest(coalesce(avg_monthly, 0), 0) > 4000 then 'مهم'
    when greatest(coalesce(avg_monthly, 0), 0) > 1500 then 'متوسط'
    else '1500 أو أقل'
  end;
$$;

create or replace function public.customer_account_kind_v2(customer_name text, customer_code text)
returns text
language sql
immutable
as $$
  with normalized as (
    select
      lower(translate(coalesce(customer_name, ''), 'أإآىة', 'ااايه')) as n,
      public.normalize_customer_code_v2(customer_code) as c
  )
  select case
    when n ~ '(الجرد|العجز|ابو العزم|أبو العزم|فرع الشامي|فرع شكري|حساب داخلي)' then 'internal_account'
    when n ~ '(عميل الصيدليه|عميل الصيدلية|عميل غير مسجل|عميل غير محدد|غير معروف|anonymous|unknown|نقدي|كاش)' then 'pseudo_customer'
    when c is null or length(btrim(n)) < 3 or n ~ '^[[:digit:][:punct:][:space:]]+$' then 'invalid_customer'
    else 'real_customer'
  end
  from normalized;
$$;

create table if not exists public.customer_data_review_queue (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid null,
  customer_code text null,
  issue_type text not null,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high', 'critical')),
  current_value jsonb not null default '{}'::jsonb,
  suggested_value jsonb not null default '{}'::jsonb,
  source text not null default 'system',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'resolved')),
  reviewed_by text null,
  reviewed_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customer_data_review_queue_status
  on public.customer_data_review_queue(status, severity, created_at desc);
create index if not exists idx_customer_data_review_queue_code
  on public.customer_data_review_queue(customer_code);

create table if not exists public.customer_data_change_log (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid null,
  customer_code text null,
  operation text not null,
  before_data jsonb null,
  after_data jsonb null,
  reason text null,
  changed_by text null,
  batch_id uuid null,
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_data_change_log_customer
  on public.customer_data_change_log(customer_id, created_at desc);
create index if not exists idx_customer_data_change_log_code
  on public.customer_data_change_log(customer_code, created_at desc);

alter table public.customer_data_review_queue enable row level security;
alter table public.customer_data_change_log enable row level security;

-- Read access follows authenticated application access. Writes remain unavailable
-- until an explicit admin RPC is introduced, preventing accidental browser-side edits.
drop policy if exists customer_data_review_queue_authenticated_read on public.customer_data_review_queue;
create policy customer_data_review_queue_authenticated_read
  on public.customer_data_review_queue
  for select
  to authenticated
  using (true);

drop policy if exists customer_data_change_log_authenticated_read on public.customer_data_change_log;
create policy customer_data_change_log_authenticated_read
  on public.customer_data_change_log
  for select
  to authenticated
  using (true);

-- Diagnostic view only. It never changes customer records.
create or replace view public.customer_data_quality_v2
with (security_invoker = true)
as
select
  c.id as customer_id,
  public.normalize_customer_code_v2(c.customer_code::text) as customer_code,
  c.name as customer_name,
  c.phone,
  c.mobile,
  c.address,
  c.branch as registered_branch,
  public.customer_account_kind_v2(c.name, c.customer_code::text) as account_kind,
  array_remove(array[
    case when public.normalize_customer_code_v2(c.customer_code::text) is null then 'missing_or_invalid_code' end,
    case when c.name is null or length(btrim(c.name)) < 3 then 'invalid_name' end,
    case when coalesce(c.phone, c.mobile, '') = '' then 'missing_phone' end,
    case when c.branch is null or btrim(c.branch) = '' then 'missing_registered_branch' end
  ], null) as quality_issues,
  greatest(
    0,
    100
      - case when public.normalize_customer_code_v2(c.customer_code::text) is null then 40 else 0 end
      - case when c.name is null or length(btrim(c.name)) < 3 then 30 else 0 end
      - case when coalesce(c.phone, c.mobile, '') = '' then 15 else 0 end
      - case when c.branch is null or btrim(c.branch) = '' then 15 else 0 end
  )::integer as data_quality_score
from public.customers c;

grant execute on function public.normalize_customer_code_v2(text) to authenticated;
grant execute on function public.classify_customer_avg_monthly_v2(numeric) to authenticated;
grant execute on function public.customer_account_kind_v2(text, text) to authenticated;
grant select on public.customer_data_quality_v2 to authenticated;
grant select on public.customer_data_review_queue to authenticated;
grant select on public.customer_data_change_log to authenticated;

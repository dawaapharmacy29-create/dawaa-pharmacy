begin;

-- Old rows may violate current workflow guards (past postponements or missing legacy closure text).
-- Disable only the state guard during this controlled, auditable cleanup and restore it before commit.
alter table public.daily_followups disable trigger trg_daily_followups_state_guard_v2;

update public.daily_followups
set cancelled_reason = case when cancelled_at is not null then coalesce(nullif(trim(cancelled_reason),''), 'إلغاء قديم قبل إلزام تسجيل السبب') else cancelled_reason end,
    followup_summary = case when completed_at is not null then coalesce(nullif(trim(followup_summary),''), 'متابعة قديمة مكتملة ومحفوظة في السجل التاريخي') else followup_summary end,
    completed_by = case when completed_at is not null then coalesce(nullif(trim(completed_by),''), 'system_cleanup_v5') else completed_by end,
    archived_by = case when archived_at is not null then coalesce(nullif(trim(archived_by),''), 'system_cleanup_v5') else archived_by end,
    archive_reason = case when archived_at is not null then coalesce(nullif(trim(archive_reason),''), 'أرشفة قديمة قبل إلزام تسجيل السبب') else archive_reason end,
    is_hidden = true,
    hidden_at = coalesce(hidden_at, now()),
    hidden_by = coalesce(hidden_by, 'system_cleanup_v5'),
    hidden_reason = coalesce(hidden_reason,
      case
        when duplicate_of is not null or is_duplicate is true then 'سجل مكرر محفوظ في التاريخ'
        when completed_at is not null then 'متابعة مكتملة محفوظة في التاريخ'
        when cancelled_at is not null then 'متابعة ملغاة محفوظة في التاريخ'
        when archived_at is not null then 'متابعة مؤرشفة محفوظة في التاريخ'
        else 'تنظيف قائمة التشغيل القديمة'
      end)
where coalesce(is_hidden,false) = false
  and (completed_at is not null or cancelled_at is not null or archived_at is not null or duplicate_of is not null or is_duplicate is true);

-- Enrich legacy rows from the canonical customer record without changing identity fields.
-- This avoids breaking the one-open-case-per-customer/branch unique guard.
update public.daily_followups f
set total_spent = coalesce(f.total_spent, c.total_spent),
    segment = coalesce(nullif(trim(f.segment),''), c.segment),
    last_purchase_date = coalesce(f.last_purchase_date, c.last_purchase),
    customer_metrics = coalesce(f.customer_metrics,'{}'::jsonb) || jsonb_build_object(
      'customer_id', c.id::text, 'customer_code', c.customer_code, 'customer_name', c.name,
      'customer_phone', coalesce(nullif(trim(c.mobile),''), nullif(trim(c.whatsapp),''), nullif(trim(c.phone),'')),
      'branch', c.branch, 'total_spent', coalesce(c.total_spent,0), 'avg_monthly', coalesce(c.avg_monthly,0),
      'avg_invoice', coalesce(c.avg_invoice,0), 'invoices_count', coalesce(c.invoices_count,0),
      'first_purchase', c.first_purchase, 'last_purchase', c.last_purchase, 'segment', c.segment, 'status', c.status
    ),
    updated_at = now()
from public.customers c
where f.customer_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  and c.id = f.customer_id::uuid;

update public.daily_followups f
set total_spent = coalesce(f.total_spent, c.total_spent),
    segment = coalesce(nullif(trim(f.segment),''), c.segment),
    last_purchase_date = coalesce(f.last_purchase_date, c.last_purchase),
    customer_metrics = coalesce(f.customer_metrics,'{}'::jsonb) || jsonb_build_object(
      'customer_id', c.id::text, 'customer_code', c.customer_code, 'customer_name', c.name,
      'customer_phone', coalesce(nullif(trim(c.mobile),''), nullif(trim(c.whatsapp),''), nullif(trim(c.phone),'')),
      'branch', c.branch, 'total_spent', coalesce(c.total_spent,0), 'avg_monthly', coalesce(c.avg_monthly,0),
      'avg_invoice', coalesce(c.avg_invoice,0), 'invoices_count', coalesce(c.invoices_count,0),
      'first_purchase', c.first_purchase, 'last_purchase', c.last_purchase, 'segment', c.segment, 'status', c.status
    ),
    updated_at = now()
from public.customers c
where nullif(trim(f.customer_code),'') is not null
  and c.customer_code = trim(f.customer_code)
  and (f.customer_metrics is null or f.total_spent is null or f.last_purchase_date is null);

with customer_phone_match as (
  select distinct on (digits)
    id, name, customer_code, branch, total_spent, avg_monthly, avg_invoice, invoices_count,
    first_purchase, last_purchase, segment, status, digits,
    coalesce(nullif(trim(mobile),''), nullif(trim(whatsapp),''), nullif(trim(phone),'')) as best_phone
  from (
    select c.*, regexp_replace(coalesce(nullif(trim(c.mobile),''), nullif(trim(c.whatsapp),''), nullif(trim(c.phone),'')), '\D','','g') digits
    from public.customers c
  ) x
  where length(digits) >= 10
  order by digits, coalesce(last_purchase, first_purchase) desc nulls last
)
update public.daily_followups f
set total_spent = coalesce(f.total_spent, c.total_spent),
    segment = coalesce(nullif(trim(f.segment),''), c.segment),
    last_purchase_date = coalesce(f.last_purchase_date, c.last_purchase),
    customer_metrics = coalesce(f.customer_metrics,'{}'::jsonb) || jsonb_build_object(
      'customer_id', c.id::text, 'customer_code', c.customer_code, 'customer_name', c.name,
      'customer_phone', c.best_phone, 'branch', c.branch, 'total_spent', coalesce(c.total_spent,0),
      'avg_monthly', coalesce(c.avg_monthly,0), 'avg_invoice', coalesce(c.avg_invoice,0),
      'invoices_count', coalesce(c.invoices_count,0), 'first_purchase', c.first_purchase,
      'last_purchase', c.last_purchase, 'segment', c.segment, 'status', c.status
    ),
    updated_at = now()
from customer_phone_match c
where regexp_replace(coalesce(nullif(trim(f.customer_phone),''), nullif(trim(f.phone),'')), '\D','','g') = c.digits
  and length(c.digits) >= 10
  and (f.customer_metrics is null or f.total_spent is null or f.last_purchase_date is null);

alter table public.daily_followups enable trigger trg_daily_followups_state_guard_v2;

commit;

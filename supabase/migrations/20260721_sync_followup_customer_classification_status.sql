begin;

with calculated as (
  select
    d.id,
    coalesce(
      nullif((d.customer_metrics->>'avg_monthly')::numeric, 0),
      nullif((d.customer_metrics->>'monthly_average')::numeric, 0),
      0
    ) as avg_monthly,
    coalesce(
      nullif(d.customer_metrics->>'last_purchase', ''),
      nullif(d.last_purchase_date::text, '')
    ) as last_purchase
  from public.daily_followups d
  where d.is_hidden = false
    and d.completed_at is null
    and d.cancelled_at is null
    and d.archived_at is null
), normalized as (
  select
    id,
    avg_monthly,
    last_purchase,
    case
      when avg_monthly >= 8000 then 'مهم جدًا'
      when avg_monthly >= 4000 then 'مهم'
      when avg_monthly >= 1500 then 'متوسط'
      when avg_monthly > 0 then 'عادي'
      else 'غير محدد'
    end as customer_classification,
    case
      when last_purchase is null then 'غير معروف'
      when current_date - last_purchase::date <= 14 then 'حديث'
      when current_date - last_purchase::date <= 30 then 'نشط'
      when current_date - last_purchase::date <= 60 then 'مهدد بالتوقف'
      else 'متوقف'
    end as activity_status,
    case
      when last_purchase is null then null
      else current_date - last_purchase::date
    end as days_since_last_purchase
  from calculated
)
update public.daily_followups d
set
  segment = n.customer_classification,
  classification = n.customer_classification,
  customer_status = n.activity_status,
  last_purchase_date = coalesce(d.last_purchase_date, n.last_purchase::date),
  customer_metrics = coalesce(d.customer_metrics, '{}'::jsonb) || jsonb_build_object(
    'avg_monthly', n.avg_monthly,
    'segment', n.customer_classification,
    'classification', n.customer_classification,
    'customer_status', n.activity_status,
    'retention_status', n.activity_status,
    'last_purchase', n.last_purchase,
    'days_since_last_purchase', n.days_since_last_purchase,
    'classification_rule_version', 'dawaa_customer_rules_v1'
  )
from normalized n
where d.id = n.id;

commit;

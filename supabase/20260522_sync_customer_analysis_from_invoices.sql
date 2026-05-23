-- مزامنة تحليل العملاء من فواتير المبيعات
-- شغّل هذا الملف مرة واحدة بعد رفع النسخة الجديدة، ثم كرره عند الحاجة لإصلاح أي بيانات قديمة.
-- الهدف: تحديث آخر شراء / أول شراء / إجمالي الفواتير / إجمالي المشتريات / متوسط شهري لكل عميل من sales_invoices.

with invoice_rollup as (
  select
    coalesce(nullif(customer_code, ''), nullif(customer_phone, ''), 'unknown:' || md5(coalesce(customer_name, '') || coalesce(customer_phone, ''))) as customer_code,
    max(nullif(customer_name, '')) as name,
    max(nullif(customer_phone, '')) as phone,
    (array_agg(branch order by amount desc nulls last))[1] as branch,
    count(*)::numeric as total_invoices,
    coalesce(sum(amount), 0)::numeric as total_spent,
    min(invoice_date::date) as first_purchase,
    max(invoice_date::date) as last_purchase,
    round(coalesce(sum(amount), 0) / greatest(1, count(*)))::numeric as avg_invoice
  from public.sales_invoices
  where coalesce(customer_code, customer_phone, customer_name) is not null
  group by coalesce(nullif(customer_code, ''), nullif(customer_phone, ''), 'unknown:' || md5(coalesce(customer_name, '') || coalesce(customer_phone, '')))
),
analysis as (
  select
    customer_code,
    coalesce(name, 'عميل بدون اسم') as name,
    coalesce(phone, 'code:' || customer_code) as phone,
    branch,
    total_invoices,
    total_spent,
    first_purchase,
    last_purchase,
    greatest(1, ceil((last_purchase - first_purchase + 1)::numeric / 30.0)) as months_active,
    avg_invoice
  from invoice_rollup
)
insert into public.customer_analysis (
  customer_code,
  name,
  phone,
  branch,
  total_invoices,
  total_spent,
  avg_monthly,
  avg_invoice,
  segment,
  status,
  priority,
  days_inactive,
  first_purchase,
  last_purchase,
  updated_at
)
select
  customer_code,
  name,
  phone,
  branch,
  total_invoices,
  total_spent,
  round(total_spent / months_active)::numeric as avg_monthly,
  avg_invoice,
  case
    when round(total_spent / months_active) >= 8000 then 'مهم جداً'
    when round(total_spent / months_active) >= 4000 then 'مهم'
    when round(total_spent / months_active) >= 1500 then 'متوسط'
    else 'عادي'
  end as segment,
  case
    when last_purchase >= current_date - interval '30 days' then 'محتفظ'
    when last_purchase >= current_date - interval '60 days' then 'معرض للفقدان'
    else 'مفقود'
  end as status,
  case
    when round(total_spent / months_active) >= 8000 then 'عالية'
    when round(total_spent / months_active) >= 4000 then 'متوسطة'
    else 'عادي'
  end as priority,
  (current_date - last_purchase)::int as days_inactive,
  first_purchase,
  last_purchase,
  now()
from analysis
where customer_code is not null
on conflict (customer_code)
do update set
  name = excluded.name,
  phone = excluded.phone,
  branch = excluded.branch,
  total_invoices = excluded.total_invoices,
  total_spent = excluded.total_spent,
  avg_monthly = excluded.avg_monthly,
  avg_invoice = excluded.avg_invoice,
  segment = excluded.segment,
  status = excluded.status,
  priority = excluded.priority,
  days_inactive = excluded.days_inactive,
  first_purchase = excluded.first_purchase,
  last_purchase = excluded.last_purchase,
  updated_at = now();

-- فحص سريع بعد التشغيل:
select
  customer_code,
  name,
  phone,
  branch,
  total_invoices,
  total_spent,
  avg_monthly,
  first_purchase,
  last_purchase,
  status,
  segment
from public.customer_analysis
order by last_purchase desc nulls last
limit 50;
drop function if exists public.get_invoice_data_health_v1();

create index if not exists idx_sales_invoices_health_missing_doctor_v1
  on public.sales_invoices (id)
  where seller_name is null and staff_name is null;

create index if not exists idx_sales_invoices_health_missing_customer_v1
  on public.sales_invoices (id)
  where customer_name is null and customer_code is null and customer_id is null;

create index if not exists idx_sales_invoices_health_missing_classification_v1
  on public.sales_invoices (id)
  where customer_segment is null and customer_type is null;

create or replace function public.get_invoice_data_health_v1()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with total as (
  select count(*)::bigint n from public.sales_invoices
), doctor_count as (
  select count(*)::bigint n from public.sales_invoices where seller_name is null and staff_name is null
), customer_count as (
  select count(*)::bigint n from public.sales_invoices where customer_name is null and customer_code is null and customer_id is null
), class_count as (
  select count(*)::bigint n from public.sales_invoices where customer_segment is null and customer_type is null
), doctor_sample as (
  select coalesce(jsonb_agg(id order by id), '[]'::jsonb) ids from (
    select id from public.sales_invoices where seller_name is null and staff_name is null order by id limit 100
  ) q
), customer_sample as (
  select coalesce(jsonb_agg(id order by id), '[]'::jsonb) ids from (
    select id from public.sales_invoices where customer_name is null and customer_code is null and customer_id is null order by id limit 100
  ) q
), class_sample as (
  select coalesce(jsonb_agg(id order by id), '[]'::jsonb) ids from (
    select id from public.sales_invoices where customer_segment is null and customer_type is null order by id limit 100
  ) q
)
select jsonb_build_object(
  'totalInvoices', t.n,
  'withoutDoctorCount', d.n,
  'withoutDoctorIds', ds.ids,
  'withoutCustomerCount', c.n,
  'withoutCustomerIds', cs.ids,
  'withoutClassificationCount', cl.n,
  'withoutClassificationIds', cls.ids
)
from total t cross join doctor_count d cross join customer_count c cross join class_count cl
cross join doctor_sample ds cross join customer_sample cs cross join class_sample cls;
$$;

revoke all on function public.get_invoice_data_health_v1() from public;
grant execute on function public.get_invoice_data_health_v1() to authenticated;

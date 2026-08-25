-- Sales/target exclusion policy correction.
--
-- Business rule:
-- Only these six explicit customer codes are excluded from branch sales,
-- target achievement, and doctor sales details:
--   5, 10, 54, 170, 4902, 12820
--
-- wholesale_b2b remains available as a customer-service/follow-up/VIP/points flag,
-- but it must not reduce branch sales or target/doctor performance automatically.
-- system_generic_code may contain other operational codes (e.g. 7, 20), so sales
-- exclusion must not depend on the whole flag category.

create or replace function public.dawaa_is_sales_target_excluded_customer_v1(
  p_branch text,
  p_customer_code text
)
returns boolean
language sql
stable
set search_path to 'public', 'pg_catalog'
as $function$
  select btrim(coalesce(p_customer_code, '')) = any (
    array['5', '10', '54', '170', '4902', '12820']::text[]
  );
$function$;

create or replace view public.dawaa_sales_invoices_dashboard_v1 as
select
  si.id,
  si.phone,
  si.name,
  si.amount,
  si.date,
  si.branch,
  si.invoice_no,
  si.created_at,
  si.import_batch,
  si.invoice_number,
  si.invoice_type,
  si.customer_code,
  si.customer_name,
  si.customer_phone,
  si.invoice_date,
  si.seller_name,
  si.close_time,
  si.delivery_staff,
  si.specialty,
  si.raw_data,
  si.invoice_datetime,
  si.close_datetime,
  si.analysis_datetime,
  si.gross_amount,
  si.discounted_amount,
  si.net_amount,
  si.discount_amount,
  si.courier_cash,
  si.extra_fees,
  si.line_items_count,
  si.shift_name,
  si.clinic,
  si.delivery_address,
  si.notes,
  si.save_status,
  si.device_name,
  si.customer_link_status,
  si.import_validation_status,
  si.import_warning,
  si.source_row_number,
  si.customer_id,
  si.customer_address,
  si.customer_segment,
  si.customer_type,
  si.invoice_category,
  si.shift,
  si.normalized_seller_name,
  si.branch_name,
  si.staff_id,
  si.net_total,
  si.gross_total,
  si.updated_at,
  si.whatsapp_phone,
  si.sale_date,
  si.total_amount,
  si.staff_name,
  si.source,
  1::bigint as truth_rank,
  si.save_status as status,
  si.staff_id as doctor_id,
  si.staff_id as seller_id,
  si.staff_id as employee_id
from public.sales_invoices si
where lower(coalesce(si.save_status, '')) !~ '(معلق|قيد|pending|draft|غير محفوظ)'
  and lower(coalesce(si.invoice_type, '')) !~ '(معلق|pending|draft)'
  and btrim(coalesce(si.customer_code, '')) <> all (
    array['5', '10', '54', '170', '4902', '12820']::text[]
  );

comment on view public.dawaa_sales_invoices_dashboard_v1 is
  'Canonical sales analytics truth: excludes pending invoices and only explicit sales/target codes 5,10,54,170,4902,12820. wholesale_b2b remains a customer-service flag only.';

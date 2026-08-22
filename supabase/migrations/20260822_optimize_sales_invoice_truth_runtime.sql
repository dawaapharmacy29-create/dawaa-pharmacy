-- Runtime performance hardening for the canonical analytics invoice truth.
--
-- Why:
-- dawaa_sales_invoices_dashboard_v1 previously called
-- dawaa_is_sales_target_excluded_customer_v1(...) once per invoice row.
-- On the 2026-07-26 -> 2026-08-22 cycle this made a 1,000-row analytics read
-- roughly an order of magnitude slower than the underlying indexed invoice scan.
--
-- The business rule is unchanged. We materialize the small active exclusion-code
-- set once per statement and compare invoice customer codes against that array.
-- This keeps sales_invoices as transactional truth while making the analytics view
-- suitable for dashboards and page-runtime reads.

create or replace view public.dawaa_sales_invoices_dashboard_v1 as
with excluded_customer_codes as materialized (
  select coalesce(array_agg(cf.customer_code), array[]::text[]) as codes
  from public.customer_flags cf
  where cf.flag_key in ('wholesale_b2b', 'system_generic_code')
    and coalesce(cf.is_active, false)
)
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
  1::bigint as truth_rank
from public.sales_invoices si
cross join excluded_customer_codes excluded
where not (
    btrim(coalesce(si.customer_code, '')) = any(excluded.codes)
  )
  and lower(coalesce(si.save_status, '')) !~ '(معلق|قيد|pending|draft|غير محفوظ)'
  and lower(coalesce(si.invoice_type, '')) !~ '(معلق|pending|draft)';

comment on view public.dawaa_sales_invoices_dashboard_v1 is
  'Canonical sales analytics truth. Excluded customer codes are materialized once per statement for runtime performance.';

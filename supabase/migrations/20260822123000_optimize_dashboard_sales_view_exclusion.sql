-- Executive dashboard hot-path optimization — 2026-08-22
-- Preserve the exact sales eligibility rules while replacing a per-invoice SQL
-- function call with one planner-visible anti join. This lets Postgres use the
-- existing sales-invoice and customer-flags indexes efficiently.

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
  1::bigint as truth_rank
from public.sales_invoices si
where not (
  lower(coalesce(si.save_status,'')) ~ '(معلق|قيد|pending|draft|غير محفوظ)'
  or lower(coalesce(si.invoice_type,'')) ~ '(معلق|pending|draft)'
)
and not exists (
  select 1
  from public.customer_flags cf
  where cf.flag_key in ('wholesale_b2b','system_generic_code')
    and coalesce(cf.is_active,false)
    and cf.customer_code = btrim(coalesce(si.customer_code,''))
);

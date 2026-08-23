create or replace view public.dawaa_sales_invoices_dashboard_v1 as
select
  id, phone, name, amount, date, branch, invoice_no, created_at, import_batch,
  invoice_number, invoice_type, customer_code, customer_name, customer_phone,
  invoice_date, seller_name, close_time, delivery_staff, specialty, raw_data,
  invoice_datetime, close_datetime, analysis_datetime, gross_amount,
  discounted_amount, net_amount, discount_amount, courier_cash, extra_fees,
  line_items_count, shift_name, clinic, delivery_address, notes, save_status,
  device_name, customer_link_status, import_validation_status, import_warning,
  source_row_number, customer_id, customer_address, customer_segment,
  customer_type, invoice_category, shift, normalized_seller_name, branch_name,
  staff_id, net_total, gross_total, updated_at, whatsapp_phone, sale_date,
  total_amount, staff_name, source, 1::bigint as truth_rank,
  save_status as status,
  staff_id as doctor_id,
  staff_id as seller_id,
  staff_id as employee_id
from public.sales_invoices si
where not (
  lower(coalesce(save_status,'')) ~ '(معلق|قيد|pending|draft|غير محفوظ)'
  or lower(coalesce(invoice_type,'')) ~ '(معلق|pending|draft)'
)
and not exists (
  select 1 from public.customer_flags cf
  where cf.flag_key in ('wholesale_b2b','system_generic_code')
    and coalesce(cf.is_active,false)
    and cf.customer_code=btrim(coalesce(si.customer_code,''))
);

grant select on public.dawaa_sales_invoices_dashboard_v1 to anon, authenticated;

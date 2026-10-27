-- Purchase invoice promotion: one undated sync row must not block every other invoice.
--
-- Production (2026-10-27): dawaa-promote-matched-purchase-invoices failed every 15 min
-- since 2026-10-21 11:30 UTC (2,262 failed runs) with
--   null value in column "invoice_date" of relation "purchase_invoices"
-- from a single matched sync row (system invoice 11606, فرع الشامي, 156.45). The
-- function inserts all matched rows in one statement, so 517 matched invoices
-- (20–27 Oct, 491,334.81) were not promoted.
--
-- Change (body otherwise identical to the production definition):
-- - skip sync rows without invoice_date; they stay in base44_purchase_invoice_sync
--   for manual correction and are promoted by a later run once dated. No date is
--   invented here.
-- - the function is a SECURITY DEFINER writer but was executable by PUBLIC/anon/
--   authenticated; only cron (postgres) and service_role call it.

create or replace function public.promote_matched_purchase_invoices_v1()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_count int := 0;
begin
  insert into public.purchase_invoices (
    base44_id, system_invoice_number, supplier_invoice_number, branch,
    entered_by_staff_id, invoice_date, total_value, transaction_type,
    supplier_id, purchase_category, purchase_category_source,
    source_branch, destination_branch, cash_amount, payment_type, notes,
    transfer_authorization_number
  )
  select distinct on (s.branch, s.system_invoice_number)
    s.base44_id, s.system_invoice_number, s.supplier_invoice_number, s.branch,
    s.entered_by_staff_id, s.invoice_date, coalesce(s.total_value, 0),
    coalesce(nullif(s.transaction_type, ''), 'external_purchase'),
    ps.id,
    coalesce(nullif(s.purchase_category, 'unclassified'), 'unclassified'),
    case when s.purchase_category is not null and s.purchase_category != 'unclassified' then 'supplier_default' else 'manual' end,
    s.source_branch, s.destination_branch, coalesce(s.cash_amount, 0), s.payment_type, s.notes,
    s.transfer_authorization_number
  from public.base44_purchase_invoice_sync s
  left join public.purchase_suppliers ps on ps.base44_id = s.base44_supplier_id
  where s.match_status = 'matched'
    and s.entered_by_staff_id is not null
    and s.base44_id is not null
    and s.system_invoice_number is not null
    and s.branch is not null
    and s.invoice_date is not null
    and not exists (
      select 1
      from public.purchase_invoices p
      where p.branch = s.branch
        and p.system_invoice_number = s.system_invoice_number
        and p.base44_id is distinct from s.base44_id
    )
  order by s.branch, s.system_invoice_number, s.synced_at desc
  on conflict (base44_id) where base44_id is not null do update set
    system_invoice_number = excluded.system_invoice_number,
    supplier_invoice_number = excluded.supplier_invoice_number,
    branch = excluded.branch,
    entered_by_staff_id = excluded.entered_by_staff_id,
    invoice_date = excluded.invoice_date,
    total_value = excluded.total_value,
    transaction_type = excluded.transaction_type,
    supplier_id = coalesce(excluded.supplier_id, public.purchase_invoices.supplier_id),
    purchase_category = case when excluded.purchase_category != 'unclassified' then excluded.purchase_category else public.purchase_invoices.purchase_category end,
    purchase_category_source = case when excluded.purchase_category != 'unclassified' then 'supplier_default' else public.purchase_invoices.purchase_category_source end,
    source_branch = coalesce(excluded.source_branch, public.purchase_invoices.source_branch),
    destination_branch = coalesce(excluded.destination_branch, public.purchase_invoices.destination_branch),
    cash_amount = coalesce(excluded.cash_amount, public.purchase_invoices.cash_amount),
    payment_type = coalesce(excluded.payment_type, public.purchase_invoices.payment_type),
    notes = coalesce(excluded.notes, public.purchase_invoices.notes),
    transfer_authorization_number = coalesce(excluded.transfer_authorization_number, public.purchase_invoices.transfer_authorization_number),
    updated_at = now()
  where row(
    public.purchase_invoices.system_invoice_number,
    public.purchase_invoices.supplier_invoice_number,
    public.purchase_invoices.branch,
    public.purchase_invoices.entered_by_staff_id,
    public.purchase_invoices.invoice_date,
    public.purchase_invoices.total_value,
    public.purchase_invoices.transaction_type,
    public.purchase_invoices.supplier_id,
    public.purchase_invoices.purchase_category,
    public.purchase_invoices.purchase_category_source,
    public.purchase_invoices.source_branch,
    public.purchase_invoices.destination_branch,
    public.purchase_invoices.cash_amount,
    public.purchase_invoices.payment_type,
    public.purchase_invoices.notes,
    public.purchase_invoices.transfer_authorization_number
  ) is distinct from row(
    excluded.system_invoice_number,
    excluded.supplier_invoice_number,
    excluded.branch,
    excluded.entered_by_staff_id,
    excluded.invoice_date,
    excluded.total_value,
    excluded.transaction_type,
    coalesce(excluded.supplier_id, public.purchase_invoices.supplier_id),
    case when excluded.purchase_category != 'unclassified' then excluded.purchase_category else public.purchase_invoices.purchase_category end,
    case when excluded.purchase_category != 'unclassified' then 'supplier_default' else public.purchase_invoices.purchase_category_source end,
    coalesce(excluded.source_branch, public.purchase_invoices.source_branch),
    coalesce(excluded.destination_branch, public.purchase_invoices.destination_branch),
    coalesce(excluded.cash_amount, public.purchase_invoices.cash_amount),
    coalesce(excluded.payment_type, public.purchase_invoices.payment_type),
    coalesce(excluded.notes, public.purchase_invoices.notes),
    coalesce(excluded.transfer_authorization_number, public.purchase_invoices.transfer_authorization_number)
  );

  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.promote_matched_purchase_invoices_v1() from public, anon, authenticated;
grant execute on function public.promote_matched_purchase_invoices_v1() to service_role;

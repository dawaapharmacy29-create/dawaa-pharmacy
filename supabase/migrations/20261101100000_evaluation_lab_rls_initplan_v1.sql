-- Evaluation lab load: the read policies of purchase_invoices and sales_invoice_items_v21 called the
-- actor/scope functions on every row (purchase invoices of one cycle: 4 ms without the policy, 4.4 s
-- per page with it). Wrapped in a sub-select, each function runs once per query, as the policies of
-- sales_invoices, attendance_daily_summary and customer_requests already do. Same conditions.

alter policy purchase_invoices_select on public.purchase_invoices
  using (
    (select public.dawaa_actor_is_top_management_v1())
    or (select public.dawaa_current_actor_can(array['manage_purchases'::text, 'view_purchases'::text]))
    or entered_by_staff_id = (select public.dawaa_current_staff_subject_uuid_v1())
    or exists (
      select 1 from public.staff_accounts a
      where a.id = (select public.dawaa_current_staff_account_id_strict())
        and lower(btrim(coalesce(a.branch, ''))) = lower(btrim(coalesce(purchase_invoices.branch, '')))
    )
  );

alter policy sales_invoice_items_v21_select on public.sales_invoice_items_v21
  using (
    (select public.dawaa_current_sales_invoice_scope_v1(array['view_dashboard'::text, 'view_sales'::text, 'view_invoice_import'::text,
      'view_all_invoices'::text, 'import_sales_invoices'::text, 'view_quarterly_incentives'::text, 'view_points'::text])) = 'ALL'
    or branch = (select public.dawaa_current_sales_invoice_scope_v1(array['view_dashboard'::text, 'view_sales'::text, 'view_invoice_import'::text,
      'view_all_invoices'::text, 'import_sales_invoices'::text, 'view_quarterly_incentives'::text, 'view_points'::text]))
  );

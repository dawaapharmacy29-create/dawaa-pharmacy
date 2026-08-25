-- Canonical sales-invoice access: permission + branch, with imports as the only client write path.

create or replace function public.dawaa_current_sales_invoice_scope_v1(p_permissions text[])
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid;
  v_role text;
  v_branch_key text;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null or not public.dawaa_current_actor_can(p_permissions) then return 'NONE'; end if;

  select pg_catalog.lower(pg_catalog.btrim(coalesce(sa.role, ''))),
         public.dawaa_customer_request_branch_key(sa.branch)
    into v_role, v_branch_key
  from public.staff_accounts sa
  where sa.id = v_actor_id and coalesce(sa.active, false) and coalesce(sa.can_login, false)
  limit 1;

  if not found then return 'NONE'; end if;
  if v_role in ('general_manager','executive_manager','branches_manager','admin') then return 'ALL'; end if;
  if v_branch_key = 'shokry' then return 'فرع شكري'; end if;
  if v_branch_key = 'elshamy' then return 'فرع الشامي'; end if;
  return 'NONE';
end;
$$;

-- Preserve the former operational import team as explicit, reviewable permissions.
insert into public.staff_permission_overrides(staff_account_id, permission_key, allowed, reason)
select sa.id, permission_key, true, 'Canonical migration from legacy invoice-import name allowlist'
from public.staff_accounts sa
cross join (values ('view_invoice_import'),('import_sales_invoices')) p(permission_key)
where coalesce(sa.active,false) and coalesce(sa.can_login,false)
  and (
    (sa.staff_name = 'د/ علياء' and sa.role = 'branch_manager')
    or (sa.staff_name = 'د اميرة' and sa.role = 'branch_manager')
    or (sa.staff_name = 'د/ علا' and sa.role = 'branches_manager')
  )
on conflict (staff_account_id, permission_key)
do update set allowed = excluded.allowed, reason = excluded.reason;

alter table public.sales_invoices enable row level security;

drop policy if exists "Allow anon insert sales invoices" on public.sales_invoices;
drop policy if exists "Allow anon read sales invoices" on public.sales_invoices;
drop policy if exists sales_invoices_admin_all on public.sales_invoices;
drop policy if exists sales_invoices_auth_insert on public.sales_invoices;
drop policy if exists sales_invoices_auth_select on public.sales_invoices;
drop policy if exists sales_invoices_auth_update on public.sales_invoices;
drop policy if exists sales_invoices_insert_app on public.sales_invoices;
drop policy if exists sales_invoices_manager_delete on public.sales_invoices;
drop policy if exists sales_invoices_select_app on public.sales_invoices;
drop policy if exists sales_invoices_update_app on public.sales_invoices;

create policy sales_invoices_scoped_select
on public.sales_invoices for select to anon, authenticated
using (
  (select public.dawaa_current_sales_invoice_scope_v1(array[
    'view_dashboard','view_branch_dashboard','view_doctor_dashboard','view_customers',
    'view_customer_details','view_customer_service','view_analytics','view_analytics_sales',
    'view_sales_reports','export_sales_reports','view_invoices','view_invoice_import',
    'import_sales_invoices','view_quarterly_incentives','view_points'
  ])) = 'ALL'
  or coalesce(branch, branch_name) = (select public.dawaa_current_sales_invoice_scope_v1(array[
    'view_dashboard','view_branch_dashboard','view_doctor_dashboard','view_customers',
    'view_customer_details','view_customer_service','view_analytics','view_analytics_sales',
    'view_sales_reports','export_sales_reports','view_invoices','view_invoice_import',
    'import_sales_invoices','view_quarterly_incentives','view_points'
  ]))
);

create policy sales_invoices_scoped_insert
on public.sales_invoices for insert to anon, authenticated
with check (
  (select public.dawaa_current_sales_invoice_scope_v1(array['import_sales_invoices'])) = 'ALL'
  or coalesce(branch, branch_name) = (select public.dawaa_current_sales_invoice_scope_v1(array['import_sales_invoices']))
);

create policy sales_invoices_scoped_update
on public.sales_invoices for update to anon, authenticated
using (
  (select public.dawaa_current_sales_invoice_scope_v1(array['import_sales_invoices'])) = 'ALL'
  or coalesce(branch, branch_name) = (select public.dawaa_current_sales_invoice_scope_v1(array['import_sales_invoices']))
)
with check (
  (select public.dawaa_current_sales_invoice_scope_v1(array['import_sales_invoices'])) = 'ALL'
  or coalesce(branch, branch_name) = (select public.dawaa_current_sales_invoice_scope_v1(array['import_sales_invoices']))
);

create policy sales_invoices_global_import_delete
on public.sales_invoices for delete to anon, authenticated
using ((select public.dawaa_current_sales_invoice_scope_v1(array['import_sales_invoices'])) = 'ALL');

-- Existing identity invariant: one invoice number per branch, independent of date corrections.
create unique index if not exists idx_sales_invoices_unique_branch_invoice_no
  on public.sales_invoices(branch, invoice_no)
  where invoice_no is not null and invoice_no <> '';

revoke truncate on public.sales_invoices from anon, authenticated;
revoke all on function public.dawaa_current_sales_invoice_scope_v1(text[]) from public;
grant execute on function public.dawaa_current_sales_invoice_scope_v1(text[]) to anon, authenticated, service_role;


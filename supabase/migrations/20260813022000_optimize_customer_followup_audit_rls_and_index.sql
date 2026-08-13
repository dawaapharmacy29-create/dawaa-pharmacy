create or replace function public.dawaa_customer_intelligence_access_scope_v1()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when lower(coalesce(a.role,'')) in ('admin','owner','general_manager','executive_manager','branches_manager','manager') then 'ALL'
    when lower(coalesce(a.role,'')) in ('customer_service_manager','customer_service') then lower(btrim(coalesce(a.branch,'')))
    else ''
  end
  from public.staff_accounts a
  where a.id = public.dawaa_current_staff_account_id_strict()
    and coalesce(a.active,false)
    and coalesce(a.can_login,false)
  limit 1
$$;

grant execute on function public.dawaa_customer_intelligence_access_scope_v1() to anon, authenticated;

create index if not exists customer_followup_audit_log_created_at_desc_idx
  on public.customer_followup_audit_log(created_at desc);

drop policy if exists customer_followup_audit_log_select_scope on public.customer_followup_audit_log;
create policy customer_followup_audit_log_select_scope
on public.customer_followup_audit_log
for select
to anon, authenticated
using (
  (select public.dawaa_customer_intelligence_access_scope_v1()) = 'ALL'
  or lower(btrim(coalesce(branch,''))) = (select public.dawaa_customer_intelligence_access_scope_v1())
);

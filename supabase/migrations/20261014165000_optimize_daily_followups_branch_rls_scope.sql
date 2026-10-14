create or replace function public.dawaa_customer_service_branch_scope_v1()
returns text
language plpgsql
stable
security definer
set search_path to 'public','auth','pg_catalog'
as $function$
declare
  a public.staff_accounts;
  v_id uuid;
  v_role text;
  v_branch text;
begin
  v_id := public.dawaa_current_staff_account_id_strict();
  if v_id is null then return null; end if;

  select * into a
  from public.staff_accounts
  where id = v_id
    and coalesce(active,false)
    and coalesce(can_login,false);
  if not found then return null; end if;

  v_role := lower(trim(coalesce(a.role,a.staff_role,'')));
  v_branch := nullif(trim(coalesce(a.branch,'')), '');

  if v_role in ('admin','owner','general_manager','executive_manager','branches_manager','manager','team_dawaa_alpha') then
    return '*';
  end if;

  return v_branch;
end
$function$;

revoke all on function public.dawaa_customer_service_branch_scope_v1() from public;
grant execute on function public.dawaa_customer_service_branch_scope_v1() to anon, authenticated;

alter policy daily_followups_branch_select_v3
on public.daily_followups
using (
  (select public.dawaa_customer_service_branch_scope_v1()) = '*'
  or nullif(trim(coalesce(branch,'')), '') = (select public.dawaa_customer_service_branch_scope_v1())
);

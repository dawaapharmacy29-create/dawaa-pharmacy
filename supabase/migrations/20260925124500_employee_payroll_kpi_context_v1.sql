-- Employee Payroll KPI Context V1
-- Read-only KPI context for payroll transparency.
-- KPIs are displayed separately from the financial formula unless an incentive contract
-- explicitly converts them into a payable amount.

create or replace function public.employee_payroll_kpi_context_v1(
  p_staff_id uuid,
  p_month_cycle text
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_username text;
  v_branch text;
  v_start date;
  v_end date;
  v_points jsonb:='{}'::jsonb;
  v_branch_target jsonb:='{}'::jsonb;
  v_branch_kpis jsonb:='{}'::jsonb;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_payroll_kpi_context_input' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;

  if not found then
    raise exception 'active_staff_actor_required' using errcode='42501';
  end if;

  select sa.username,coalesce(nullif(trim(s.branch),''),nullif(trim(sa.branch),''))
  into v_username,v_branch
  from public.staff_accounts sa
  left join public.staff s on s.id::text=sa.staff_id::text
  where sa.staff_id=p_staff_id::text
  order by coalesce(sa.active,true) desc,sa.created_at desc nulls last
  limit 1;

  if v_username is null
     or not public.dawaa_current_actor_can(array['manage_payroll'])
     or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_payroll_kpi_context' using errcode='42501';
  end if;

  select cycle_start,cycle_end
  into v_start,v_end
  from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD'));

  begin
    select to_jsonb(t) into v_points
    from public.dawaa_staff_points_truth_v2(p_staff_id,p_month_cycle) t
    limit 1;
  exception when others then
    v_points:=jsonb_build_object('available',false,'reason','staff_points_truth_unavailable');
  end;

  select coalesce(to_jsonb(t),'{}'::jsonb)
  into v_branch_target
  from public.dawaa_branch_target_progress_v13 t
  where t.branch=v_branch
    and t.cycle_start=v_start
    and t.cycle_end=v_end
  limit 1;

  begin
    select to_jsonb(k) into v_branch_kpis
    from public.get_dashboard_kpis(v_start,v_end,v_branch) k
    limit 1;
  exception when others then
    v_branch_kpis:=jsonb_build_object('available',false,'reason','branch_kpis_unavailable');
  end;

  return jsonb_build_object(
    'schema','employee_payroll_kpi_context_v1',
    'staff_id',p_staff_id,
    'month_cycle',p_month_cycle,
    'branch',v_branch,
    'cycle_start',v_start,
    'cycle_end',v_end,
    'staff_performance',coalesce(v_points,'{}'::jsonb),
    'branch_target',coalesce(v_branch_target,'{}'::jsonb),
    'branch_kpis',coalesce(v_branch_kpis,'{}'::jsonb),
    'employee_sales_kpi',jsonb_build_object(
      'available',false,
      'reason','canonical_employee_sales_contract_not_bound_yet'
    ),
    'financial_rule','KPIs are context only; payable effects come from explicit incentive truth',
    'generated_at',now()
  );
end;
$function$;

revoke execute on function public.employee_payroll_kpi_context_v1(uuid,text) from public,anon;
grant execute on function public.employee_payroll_kpi_context_v1(uuid,text)
  to authenticated,service_role;

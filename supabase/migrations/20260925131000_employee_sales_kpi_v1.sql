-- Canonical employee sales KPI for payroll statement.
-- Resolves the employee by staff_id, then matches the canonical staff name and
-- registered aliases against normalized invoice seller identity.

create or replace function public.employee_sales_kpi_v1(
  p_staff_id uuid,
  p_start date,
  p_end date
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
  v_name text;
  v_total numeric:=0;
  v_count bigint:=0;
  v_avg numeric:=0;
  v_branches jsonb:='[]'::jsonb;
  v_aliases jsonb:='[]'::jsonb;
begin
  if p_staff_id is null or p_start is null or p_end is null or p_end<p_start then
    raise exception 'invalid_employee_sales_kpi_input' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;

  if not found then
    raise exception 'active_staff_actor_required' using errcode='42501';
  end if;

  select sa.username,coalesce(s.name,sa.name,sa.staff_name,sa.username)
  into v_username,v_name
  from public.staff_accounts sa
  left join public.staff s on s.id::text=sa.staff_id::text
  where sa.staff_id=p_staff_id::text
  order by coalesce(sa.active,true) desc,sa.created_at desc nulls last
  limit 1;

  if v_username is null
     or not public.dawaa_current_actor_can(array['manage_payroll'])
     or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_employee_sales_kpi' using errcode='42501';
  end if;

  with identities as (
    select distinct public.normalize_cs_identity_name(x.identity_name) norm
    from (
      select v_name::text identity_name
      union all
      select s.name from public.staff s where s.id=p_staff_id
      union all
      select a.alias_name
      from public.staff_identity_aliases a
      where a.staff_id=p_staff_id and coalesce(a.active,true)
    ) x
    where nullif(btrim(coalesce(x.identity_name,'')),'') is not null
  ),
  scoped as (
    select
      coalesce(nullif(btrim(si.branch),''),'غير محدد') branch,
      coalesce(
        nullif(si.net_total,0),
        nullif(si.net_amount,0),
        nullif(si.discounted_amount,0),
        nullif(si.total_amount,0),
        nullif(si.amount,0),
        0
      )::numeric amount
    from public.dawaa_sales_invoices_dashboard_v1 si
    where si.invoice_date>=p_start::timestamp
      and si.invoice_date<(p_end+1)::timestamp
      and exists (
        select 1
        from identities i
        where i.norm=public.normalize_cs_identity_name(
          coalesce(
            nullif(btrim(si.seller_name),''),
            nullif(btrim(si.staff_name),''),
            nullif(btrim(si.normalized_seller_name),'')
          )
        )
      )
  ),
  by_branch as (
    select branch,sum(amount)::numeric sales_total,count(*)::bigint invoices_count
    from scoped
    group by branch
  )
  select
    coalesce(sum(sales_total),0),
    coalesce(sum(invoices_count),0),
    case when coalesce(sum(invoices_count),0)>0
      then round(coalesce(sum(sales_total),0)/sum(invoices_count),2)
      else 0 end,
    coalesce(jsonb_agg(jsonb_build_object(
      'branch',branch,
      'sales_total',sales_total,
      'invoices_count',invoices_count,
      'avg_invoice',case when invoices_count>0 then round(sales_total/invoices_count,2) else 0 end
    ) order by sales_total desc),'[]'::jsonb)
  into v_total,v_count,v_avg,v_branches
  from by_branch;

  select coalesce(jsonb_agg(identity_name order by identity_name),'[]'::jsonb)
  into v_aliases
  from (
    select distinct x.identity_name
    from (
      select v_name::text identity_name
      union all
      select s.name from public.staff s where s.id=p_staff_id
      union all
      select a.alias_name from public.staff_identity_aliases a
      where a.staff_id=p_staff_id and coalesce(a.active,true)
    ) x
    where nullif(btrim(coalesce(x.identity_name,'')),'') is not null
  ) q;

  return jsonb_build_object(
    'schema','employee_sales_kpi_v1',
    'staff_id',p_staff_id,
    'staff_name',v_name,
    'start_date',p_start,
    'end_date',p_end,
    'sales_total',round(v_total,2),
    'invoices_count',v_count,
    'avg_invoice',round(v_avg,2),
    'branch_breakdown',v_branches,
    'matched_identities',v_aliases,
    'identity_rule','staff canonical name + active staff_identity_aliases'
  );
end;
$function$;

revoke execute on function public.employee_sales_kpi_v1(uuid,date,date) from public,anon;
grant execute on function public.employee_sales_kpi_v1(uuid,date,date)
  to authenticated,service_role;

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
  v_employee_sales jsonb:='{}'::jsonb;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_payroll_kpi_context_input' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;

  if not found then raise exception 'active_staff_actor_required' using errcode='42501'; end if;

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

  select cycle_start,cycle_end into v_start,v_end
  from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD'));

  begin
    select to_jsonb(t) into v_points
    from public.dawaa_staff_points_truth_v2(p_staff_id,p_month_cycle) t limit 1;
  exception when others then
    v_points:=jsonb_build_object('available',false,'reason','staff_points_truth_unavailable');
  end;

  select coalesce(to_jsonb(t),'{}'::jsonb) into v_branch_target
  from public.dawaa_branch_target_progress_v13 t
  where t.branch=v_branch and t.cycle_start=v_start and t.cycle_end=v_end limit 1;

  begin
    select to_jsonb(k) into v_branch_kpis
    from public.get_dashboard_kpis(v_start,v_end,v_branch) k limit 1;
  exception when others then
    v_branch_kpis:=jsonb_build_object('available',false,'reason','branch_kpis_unavailable');
  end;

  begin
    v_employee_sales:=public.employee_sales_kpi_v1(p_staff_id,v_start,v_end);
  exception when others then
    v_employee_sales:=jsonb_build_object('available',false,'reason','employee_sales_kpi_unavailable');
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
    'employee_sales_kpi',coalesce(v_employee_sales,'{}'::jsonb),
    'financial_rule','KPIs are context only; payable effects come from explicit incentive truth',
    'generated_at',now()
  );
end;
$function$;

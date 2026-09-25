-- Payroll cycle readiness V2.
-- Scope begins from active staff/accounts, not compensation profiles, so missing
-- configuration cannot silently disappear from the readiness screen.

create or replace function public.payroll_cycle_finalization_overview_v2(
  p_month_cycle text,
  p_branch text default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_result jsonb;
begin
  if coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_payroll_cycle_overview_input' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true
    and coalesce(can_login,false)=true;

  if not found or not public.dawaa_current_actor_can(array['manage_payroll']) then
    raise exception 'not_authorized_for_payroll_cycle_overview' using errcode='42501';
  end if;

  with scoped_staff as (
    select distinct on (s.id)
      s.id as staff_id,
      s.name as staff_name,
      s.role,
      s.branch,
      sa.username
    from public.staff s
    join public.staff_accounts sa on sa.staff_id=s.id::text
    where coalesce(s.active,s.is_active,true)
      and coalesce(s.status,'active') not in ('inactive','deleted','disabled')
      and coalesce(sa.active,true)
      and coalesce(sa.can_login,true)
      and public.dawaa_can_manage_payroll_staff_v1(sa.username)
      and (
        p_branch is null or trim(p_branch)='' or p_branch='الكل'
        or trim(coalesce(s.branch,sa.branch,''))=trim(p_branch)
      )
    order by s.id,sa.updated_at desc nulls last,sa.created_at desc nulls last
  ),
  profile_state as (
    select ss.*,
      exists(
        select 1 from public.employee_compensation_profiles p
        where p.staff_id=ss.staff_id::text and coalesce(p.active,true)
      ) as has_profile,
      (
        select count(*)::integer
        from public.employee_transactions et
        where et.staff_id=ss.staff_id
          and et.month_cycle=p_month_cycle
          and et.status in ('active','approved','pending')
      ) as incentive_transactions,
      (
        select count(*)::integer
        from public.staff_payroll_monthly_v13 pm
        where pm.staff_id=ss.staff_id
      ) as payroll_history_rows
    from scoped_staff ss
  ),
  configured as (
    select * from profile_state where has_profile
  ),
  evaluated as (
    select c.*,public.payroll_finalization_gate_v1(c.staff_id,p_month_cycle) as gate
    from configured c
  ),
  limited as (
    select * from evaluated
    order by staff_name
    limit greatest(1,least(coalesce(p_limit,100),200))
  ),
  unconfigured as (
    select ps.*,
      case
        when ps.incentive_transactions>0 then 'missing_with_incentive_activity'
        when ps.payroll_history_rows>0 then 'missing_with_payroll_history'
        else 'missing_no_activity'
      end as configuration_state,
      case
        when ps.incentive_transactions>0 or ps.payroll_history_rows>0 then true
        else false
      end as priority_review
    from profile_state ps
    where not ps.has_profile
  ),
  blockers as (
    select x.value->>'code' as code,x.value->>'label' as label,count(*)::integer affected_staff
    from evaluated e
    cross join lateral jsonb_array_elements(coalesce(e.gate->'blockers','[]'::jsonb)) x(value)
    group by x.value->>'code',x.value->>'label'
  )
  select jsonb_build_object(
    'schema','payroll_cycle_finalization_overview_v2',
    'month_cycle',p_month_cycle,
    'branch',nullif(trim(coalesce(p_branch,'')),''),
    'scope_staff_count',(select count(*) from profile_state),
    'configured_staff_count',(select count(*) from configured),
    'unconfigured_staff_count',(select count(*) from unconfigured),
    'unconfigured_priority_count',(select count(*) from unconfigured where priority_review),
    -- Backward-compatible readiness metrics are for configured staff only.
    'staff_count',(select count(*) from evaluated),
    'ready_count',(select count(*) from evaluated where coalesce((gate->>'ready')::boolean,false)),
    'blocked_count',(select count(*) from evaluated where not coalesce((gate->>'ready')::boolean,false)),
    'rows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id',staff_id,
        'staff_name',staff_name,
        'role',role,
        'branch',branch,
        'configuration_state','configured',
        'ready',coalesce((gate->>'ready')::boolean,false),
        'blocker_count',jsonb_array_length(coalesce(gate->'blockers','[]'::jsonb)),
        'warning_count',jsonb_array_length(coalesce(gate->'warnings','[]'::jsonb)),
        'blockers',coalesce(gate->'blockers','[]'::jsonb),
        'warnings',coalesce(gate->'warnings','[]'::jsonb),
        'policy_validation',coalesce(gate->'policy_validation','{}'::jsonb)
      ) order by staff_name)
      from limited
    ),'[]'::jsonb),
    'configuration_queue',coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id',staff_id,
        'staff_name',staff_name,
        'role',role,
        'branch',branch,
        'configuration_state',configuration_state,
        'priority_review',priority_review,
        'incentive_transactions',incentive_transactions,
        'payroll_history_rows',payroll_history_rows
      ) order by priority_review desc,branch,role,staff_name)
      from unconfigured
    ),'[]'::jsonb),
    'top_blockers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'code',code,'label',label,'affected_staff',affected_staff
      ) order by affected_staff desc,code)
      from blockers
    ),'[]'::jsonb),
    'generated_at',now()
  ) into v_result;

  return v_result;
end;
$function$;

grant execute on function public.payroll_cycle_finalization_overview_v2(text,text,integer)
  to authenticated,service_role;

create or replace function public.payroll_cycle_finalization_overview_v1(
  p_month_cycle text,
  p_branch text default null,
  p_limit integer default 100
)
returns jsonb
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
  select public.payroll_cycle_finalization_overview_v2(p_month_cycle,p_branch,p_limit);
$function$;

comment on function public.payroll_cycle_finalization_overview_v1(text,text,integer)
  is 'COMPATIBILITY WRAPPER: canonical payroll cycle readiness is V2.';

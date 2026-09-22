
create or replace function public.payroll_cycle_finalization_overview_v1(
  p_month_cycle text,
  p_branch text default null,
  p_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_result jsonb;
begin
  if coalesce(trim(p_month_cycle),'') !~ '^\d{4}-\d{2}$' then
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

  with eligible as (
    select distinct
      p.staff_id::uuid as staff_id,
      coalesce(p.staff_name,sa.name,sa.staff_name,sa.username) as staff_name,
      coalesce(nullif(trim(p.branch),''),nullif(trim(sa.branch),'')) as branch,
      sa.username
    from public.employee_compensation_profiles p
    join public.staff_accounts sa on sa.staff_id=p.staff_id::text
    where coalesce(p.active,true)
      and coalesce(sa.active,true)
      and public.dawaa_can_manage_payroll_staff_v1(sa.username)
      and (
        p_branch is null or trim(p_branch)='' or p_branch='الكل'
        or trim(coalesce(p.branch,sa.branch,''))=trim(p_branch)
      )
  ), evaluated as (
    select e.*,
      public.payroll_finalization_gate_v1(e.staff_id,p_month_cycle) as gate
    from eligible e
  ), limited as (
    select *
    from evaluated
    order by staff_name
    limit greatest(1,least(coalesce(p_limit,100),200))
  ), blockers as (
    select
      x.value->>'code' as code,
      x.value->>'label' as label,
      count(*)::integer as affected_staff
    from evaluated e
    cross join lateral jsonb_array_elements(coalesce(e.gate->'blockers','[]'::jsonb)) x(value)
    group by x.value->>'code',x.value->>'label'
  )
  select jsonb_build_object(
    'month_cycle',p_month_cycle,
    'branch',nullif(trim(coalesce(p_branch,'')),''),
    'staff_count',(select count(*) from evaluated),
    'ready_count',(select count(*) from evaluated where coalesce((gate->>'ready')::boolean,false)),
    'blocked_count',(select count(*) from evaluated where not coalesce((gate->>'ready')::boolean,false)),
    'rows',coalesce((
      select jsonb_agg(jsonb_build_object(
        'staff_id',staff_id,
        'staff_name',staff_name,
        'branch',branch,
        'ready',coalesce((gate->>'ready')::boolean,false),
        'blocker_count',jsonb_array_length(coalesce(gate->'blockers','[]'::jsonb)),
        'warning_count',jsonb_array_length(coalesce(gate->'warnings','[]'::jsonb)),
        'blockers',coalesce(gate->'blockers','[]'::jsonb),
        'warnings',coalesce(gate->'warnings','[]'::jsonb),
        'policy_validation',coalesce(gate->'policy_validation','{}'::jsonb)
      ) order by staff_name)
      from limited
    ),'[]'::jsonb),
    'top_blockers',coalesce((
      select jsonb_agg(jsonb_build_object(
        'code',code,
        'label',label,
        'affected_staff',affected_staff
      ) order by affected_staff desc,code)
      from blockers
    ),'[]'::jsonb),
    'generated_at',now()
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.payroll_cycle_finalization_overview_v1(text,text,integer) from public,anon;
grant execute on function public.payroll_cycle_finalization_overview_v1(text,text,integer) to authenticated,service_role;

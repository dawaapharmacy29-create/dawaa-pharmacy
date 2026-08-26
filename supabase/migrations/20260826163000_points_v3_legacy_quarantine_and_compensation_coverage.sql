-- Points V3 - quarantine legacy evaluation rules and expose compensation profile coverage.
-- Historical rows are preserved; only new rule selection is disabled.

update public.evaluation_rules
set
  active = false,
  is_active = false,
  updated_at = now(),
  source = coalesce(nullif(source, ''), 'legacy_quarantined_v3')
where coalesce(active, is_active, true)
  and coalesce(
    nullif(trim(rule_code), ''),
    nullif(trim(rule_key), ''),
    id::text
  ) like 'legacy_rule_%';

create or replace function public.get_compensation_profile_coverage_v3(
  p_branch text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text := lower(trim(coalesce(public.employee_operating_actor_role(), '')));
  v_actor_branch text := nullif(trim(coalesce(public.employee_operating_actor_branch(), '')), '');
  v_requested_branch text := nullif(trim(coalesce(p_branch, '')), '');
  v_global boolean := v_role in ('general_manager', 'admin', 'executive_manager', 'branches_manager');
  v_result jsonb;
begin
  if not (v_global or v_role in ('branch_manager', 'customer_service_manager')) then
    raise exception 'not_authorized';
  end if;

  if not v_global then
    if v_actor_branch is null then
      raise exception 'manager_branch_missing';
    end if;
    if v_requested_branch is not null and v_requested_branch is distinct from v_actor_branch then
      raise exception 'not_authorized_for_branch';
    end if;
    v_requested_branch := v_actor_branch;
  end if;

  with active_staff as (
    select s.id, s.name, s.role, s.branch
    from public.staff s
    where coalesce(s.active, s.is_active, true)
      and coalesce(s.status, 'active') not in ('inactive', 'deleted', 'disabled')
      and (v_requested_branch is null or s.branch = v_requested_branch)
  ), latest_profile as (
    select distinct on (ecp.staff_id)
      ecp.staff_id,
      ecp.monthly_incentive_base,
      ecp.point_value,
      ecp.effective_from
    from public.employee_compensation_profiles ecp
    where coalesce(ecp.active, true)
      and coalesce(ecp.effective_from, current_date) <= current_date
    order by ecp.staff_id, ecp.effective_from desc nulls last, ecp.updated_at desc nulls last
  ), coverage as (
    select
      s.id as staff_id,
      s.name as staff_name,
      coalesce(s.role, '') as staff_role,
      coalesce(s.branch, '') as branch,
      p.staff_id is not null
        and coalesce(p.monthly_incentive_base, 0) > 0
        and coalesce(p.point_value, 0) > 0 as profile_configured,
      case when p.staff_id is null then 'missing_profile'
           when coalesce(p.monthly_incentive_base, 0) <= 0 then 'invalid_monthly_base'
           when coalesce(p.point_value, 0) <= 0 then 'invalid_point_value'
           else 'configured'
      end as coverage_status
    from active_staff s
    left join latest_profile p on p.staff_id = s.id::text
  ), by_role as (
    select
      staff_role,
      count(*)::int as staff_count,
      count(*) filter (where profile_configured)::int as configured_count,
      count(*) filter (where not profile_configured)::int as missing_count
    from coverage
    group by staff_role
  )
  select jsonb_build_object(
    'engine_version', 3,
    'scope_branch', coalesce(v_requested_branch, 'كل الفروع'),
    'active_staff', (select count(*) from coverage),
    'configured_profiles', (select count(*) from coverage where profile_configured),
    'missing_profiles', (select count(*) from coverage where not profile_configured),
    'coverage_pct', case
      when (select count(*) from coverage) = 0 then 100
      else round(
        100.0 * (select count(*) from coverage where profile_configured)
        / (select count(*) from coverage),
        1
      )
    end,
    'roles', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'role', r.staff_role,
          'staff_count', r.staff_count,
          'configured_count', r.configured_count,
          'missing_count', r.missing_count
        )
        order by r.missing_count desc, r.staff_count desc, r.staff_role
      )
      from by_role r
    ), '[]'::jsonb),
    'missing_staff', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'staff_id', c.staff_id,
          'staff_name', c.staff_name,
          'staff_role', c.staff_role,
          'branch', c.branch,
          'status', c.coverage_status
        )
        order by c.branch, c.staff_role, c.staff_name
      )
      from coverage c
      where not c.profile_configured
    ), '[]'::jsonb),
    'generated_at', now()
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_compensation_profile_coverage_v3(text) from public;
grant execute on function public.get_compensation_profile_coverage_v3(text) to authenticated;

comment on function public.get_compensation_profile_coverage_v3(text) is
  'Manager-only compensation coverage audit. Reports missing/invalid profiles without inventing payout values.';

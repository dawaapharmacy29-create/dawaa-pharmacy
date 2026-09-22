CREATE OR REPLACE FUNCTION public.resolve_attendance_policy_v2(p_staff_id uuid, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_staff public.staff%rowtype;
  v_result jsonb;
begin
  select * into v_staff from public.staff where id=p_staff_id;
  if not found then
    raise exception 'staff not found' using errcode='22023';
  end if;
  if not public.dawaa_can_read_staff_attendance_log(v_staff.id,v_staff.branch) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  with candidates as (
    select
      a.id as assignment_id,
      a.scope_type,
      a.scope_key,
      a.policy_version_id,
      a.effective_from as assignment_effective_from,
      a.effective_to as assignment_effective_to,
      p.policy_code,
      p.effective_from as policy_effective_from,
      p.effective_to as policy_effective_to,
      p.late_grace_minutes,
      p.very_late_minutes,
      p.early_leave_grace_minutes,
      p.shift_margin_before_minutes,
      p.shift_margin_after_minutes,
      p.expected_daily_hours,
      p.full_day_min_minutes,
      p.half_day_min_minutes,
      p.max_payable_minutes,
      p.auto_checkout_after_minutes,
      p.overtime_threshold_minutes,
      p.overtime_requires_approval,
      p.rounding_minutes,
      p.core_start,
      p.core_end,
      p.permission_limit_per_cycle,
      p.permission_max_minutes,
      p.weekly_off_allowance,
      p.annual_leave_entitlement_days,
      p.notes,
      case a.scope_type when 'staff' then 1 when 'role' then 2 when 'branch' then 3 else 4 end priority
    from public.attendance_policy_assignments a
    join public.attendance_policy_versions p
      on p.id=a.policy_version_id and p.active=true
    where a.active=true
      and p_date>=a.effective_from
      and (a.effective_to is null or p_date<=a.effective_to)
      and p_date>=p.effective_from
      and (p.effective_to is null or p_date<=p.effective_to)
      and (
        (a.scope_type='staff' and a.scope_key=p_staff_id::text)
        or (a.scope_type='role' and lower(trim(a.scope_key))=lower(trim(coalesce(v_staff.role,''))))
        or (a.scope_type='branch' and trim(a.scope_key)=trim(coalesce(v_staff.branch,'')))
        or a.scope_type='default'
      )
  )
  select jsonb_build_object(
    'assignment_id',c.assignment_id,
    'scope_type',c.scope_type,
    'scope_key',c.scope_key,
    'policy_version_id',c.policy_version_id,
    'policy_code',c.policy_code,
    'effective_from',c.policy_effective_from,
    'effective_to',c.policy_effective_to,
    'assignment_effective_from',c.assignment_effective_from,
    'assignment_effective_to',c.assignment_effective_to,
    'late_grace_minutes',c.late_grace_minutes,
    'very_late_minutes',c.very_late_minutes,
    'early_leave_grace_minutes',c.early_leave_grace_minutes,
    'shift_margin_before_minutes',c.shift_margin_before_minutes,
    'shift_margin_after_minutes',c.shift_margin_after_minutes,
    'expected_daily_hours',c.expected_daily_hours,
    'full_day_min_minutes',c.full_day_min_minutes,
    'half_day_min_minutes',c.half_day_min_minutes,
    'max_payable_minutes',c.max_payable_minutes,
    'auto_checkout_after_minutes',c.auto_checkout_after_minutes,
    'overtime_threshold_minutes',c.overtime_threshold_minutes,
    'overtime_requires_approval',c.overtime_requires_approval,
    'rounding_minutes',c.rounding_minutes,
    'core_start',c.core_start,
    'core_end',c.core_end,
    'permission_limit_per_cycle',c.permission_limit_per_cycle,
    'permission_max_minutes',c.permission_max_minutes,
    'weekly_off_allowance',c.weekly_off_allowance,
    'annual_leave_entitlement_days',c.annual_leave_entitlement_days,
    'notes',c.notes
  )
  into v_result
  from candidates c
  order by c.priority,c.assignment_effective_from desc,c.policy_effective_from desc
  limit 1;

  return coalesce(v_result,'{}'::jsonb);
end;
$function$


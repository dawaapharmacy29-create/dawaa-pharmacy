
create or replace function public.create_attendance_policy_version_v1(
  p_policy_code text,
  p_effective_from date,
  p_late_grace_minutes integer,
  p_very_late_minutes integer,
  p_early_leave_grace_minutes integer default null,
  p_overtime_threshold_minutes integer default null,
  p_rounding_minutes integer default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_base public.attendance_policy_versions%rowtype;
  v_new public.attendance_policy_versions%rowtype;
begin
  select * into v_actor from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true and coalesce(can_login,false)=true;
  if not found then raise exception 'active staff actor required' using errcode='42501'; end if;
  if coalesce(v_actor.role,'') not in ('general_manager','admin','executive_manager','branches_manager') then
    raise exception 'not_authorized_for_policy_write' using errcode='42501';
  end if;

  if nullif(trim(coalesce(p_policy_code,'')),'') is null or p_effective_from is null then
    raise exception 'policy_code_and_effective_from_required' using errcode='22023';
  end if;
  if p_late_grace_minutes<0 or p_late_grace_minutes>240
     or p_very_late_minutes<p_late_grace_minutes or p_very_late_minutes>480
     or coalesce(p_early_leave_grace_minutes,0)<0 or coalesce(p_early_leave_grace_minutes,0)>240 then
    raise exception 'invalid_attendance_policy_thresholds' using errcode='22023';
  end if;

  select * into v_base
  from public.attendance_policy_versions p
  where coalesce(p.active,false)=true
  order by p.effective_from desc,p.created_at desc
  limit 1;
  if not found then raise exception 'base_attendance_policy_missing' using errcode='22023'; end if;

  insert into public.attendance_policy_versions(
    policy_code,effective_from,effective_to,active,
    late_grace_minutes,very_late_minutes,permission_limit_per_cycle,permission_max_minutes,
    weekly_off_allowance,authorized_absence_uncompensated_days,unauthorized_absence_days,
    annual_leave_entitlement_days,annual_leave_negative_balance_allowed,notes,
    expected_daily_hours,early_leave_grace_minutes,shift_margin_before_minutes,shift_margin_after_minutes,
    full_day_min_minutes,half_day_min_minutes,max_payable_minutes,auto_checkout_after_minutes,
    overtime_threshold_minutes,overtime_requires_approval,rounding_minutes,core_start,core_end
  )
  values(
    trim(p_policy_code),p_effective_from,null,false,
    p_late_grace_minutes,p_very_late_minutes,v_base.permission_limit_per_cycle,v_base.permission_max_minutes,
    v_base.weekly_off_allowance,v_base.authorized_absence_uncompensated_days,v_base.unauthorized_absence_days,
    v_base.annual_leave_entitlement_days,v_base.annual_leave_negative_balance_allowed,
    concat_ws(' | ',nullif(v_base.notes,''),nullif(trim(coalesce(p_note,'')),'')),
    v_base.expected_daily_hours,coalesce(p_early_leave_grace_minutes,v_base.early_leave_grace_minutes),
    v_base.shift_margin_before_minutes,v_base.shift_margin_after_minutes,
    v_base.full_day_min_minutes,v_base.half_day_min_minutes,v_base.max_payable_minutes,v_base.auto_checkout_after_minutes,
    coalesce(p_overtime_threshold_minutes,v_base.overtime_threshold_minutes),v_base.overtime_requires_approval,
    coalesce(p_rounding_minutes,v_base.rounding_minutes),v_base.core_start,v_base.core_end
  )
  returning * into v_new;

  insert into public.attendance_policy_change_audit(
    action,actor_id,actor_name,policy_version_id,effective_from,after_snapshot,note
  )
  values(
    'policy_version_created_staged',v_actor.id,coalesce(v_actor.name,v_actor.username),v_new.id,v_new.effective_from,
    to_jsonb(v_new),concat_ws(' | ','staged_non_global',nullif(trim(coalesce(p_note,'')),''))
  );

  return jsonb_build_object('success',true,'policy',to_jsonb(v_new),'global_active',false);
end;
$$;

create or replace function public.assign_attendance_policy_v1(
  p_policy_version_id uuid,
  p_scope_type text,
  p_scope_key text default null,
  p_effective_from date default null,
  p_effective_to date default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_policy public.attendance_policy_versions%rowtype;
  v_assignment public.attendance_policy_assignments%rowtype;
  v_key text:=nullif(trim(coalesce(p_scope_key,'')),'');
  v_date date;
begin
  select * into v_actor from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true and coalesce(can_login,false)=true;
  if not found then raise exception 'active staff actor required' using errcode='42501'; end if;
  if coalesce(v_actor.role,'') not in ('general_manager','admin','executive_manager','branches_manager') then
    raise exception 'not_authorized_for_policy_write' using errcode='42501';
  end if;

  select * into v_policy from public.attendance_policy_versions where id=p_policy_version_id;
  if not found then raise exception 'policy_version_not_found' using errcode='22023'; end if;

  if p_scope_type not in ('staff','role','branch','default') then raise exception 'invalid_policy_scope' using errcode='22023'; end if;
  if p_scope_type='default' then
    raise exception 'staged_policy_cannot_replace_global_default_before_v3_cutover' using errcode='22023';
  end if;
  if v_key is null then raise exception 'policy_scope_key_required' using errcode='22023'; end if;

  v_date:=coalesce(p_effective_from,v_policy.effective_from);
  if p_effective_to is not null and p_effective_to<v_date then raise exception 'invalid_policy_assignment_range' using errcode='22023'; end if;

  update public.attendance_policy_assignments
  set effective_to=v_date-1,updated_at=now()
  where active=true
    and scope_type=p_scope_type
    and coalesce(scope_key,'')=coalesce(v_key,'')
    and effective_from<v_date
    and (effective_to is null or effective_to>=v_date);

  insert into public.attendance_policy_assignments(
    policy_version_id,scope_type,scope_key,effective_from,effective_to,active,notes
  )
  values(p_policy_version_id,p_scope_type,v_key,v_date,p_effective_to,true,nullif(trim(coalesce(p_note,'')),''))
  returning * into v_assignment;

  insert into public.attendance_policy_change_audit(
    action,actor_id,actor_name,policy_version_id,scope_type,scope_key,effective_from,effective_to,after_snapshot,note
  )
  values(
    'staged_policy_assigned',v_actor.id,coalesce(v_actor.name,v_actor.username),p_policy_version_id,
    p_scope_type,v_key,v_date,p_effective_to,to_jsonb(v_assignment),nullif(trim(coalesce(p_note,'')),'')
  );

  return jsonb_build_object('success',true,'assignment',to_jsonb(v_assignment));
end;
$$;

create or replace function public.dawaa_resolve_attendance_policy_internal_v1(
  p_staff_id uuid,p_date date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_staff public.staff%rowtype;
  v_result jsonb;
begin
  select * into v_staff from public.staff where id=p_staff_id;
  if not found then return '{}'::jsonb; end if;

  with candidates as (
    select
      a.id assignment_id,a.scope_type,a.scope_key,a.policy_version_id,
      a.effective_from assignment_effective_from,a.effective_to assignment_effective_to,
      p.policy_code,p.active policy_global_active,
      p.effective_from policy_effective_from,p.effective_to policy_effective_to,
      p.late_grace_minutes,p.very_late_minutes,p.early_leave_grace_minutes,
      p.shift_margin_before_minutes,p.shift_margin_after_minutes,p.expected_daily_hours,
      p.full_day_min_minutes,p.half_day_min_minutes,p.max_payable_minutes,
      p.auto_checkout_after_minutes,p.overtime_threshold_minutes,p.overtime_requires_approval,
      p.rounding_minutes,p.core_start,p.core_end,p.permission_limit_per_cycle,
      p.permission_max_minutes,p.weekly_off_allowance,p.annual_leave_entitlement_days,p.notes,
      case a.scope_type when 'staff' then 1 when 'role' then 2 when 'branch' then 3 else 4 end priority
    from public.attendance_policy_assignments a
    join public.attendance_policy_versions p on p.id=a.policy_version_id
    where a.active=true
      and p_date>=a.effective_from and (a.effective_to is null or p_date<=a.effective_to)
      and p_date>=p.effective_from and (p.effective_to is null or p_date<=p.effective_to)
      and (
        (a.scope_type='staff' and a.scope_key=p_staff_id::text)
        or (a.scope_type='role' and lower(trim(a.scope_key))=lower(trim(coalesce(v_staff.role,''))))
        or (a.scope_type='branch' and trim(a.scope_key)=trim(coalesce(v_staff.branch,'')))
        or (a.scope_type='default' and p.active=true)
      )
  )
  select jsonb_build_object(
    'assignment_id',c.assignment_id,'scope_type',c.scope_type,'scope_key',c.scope_key,
    'policy_version_id',c.policy_version_id,'policy_code',c.policy_code,'global_active',c.policy_global_active,
    'effective_from',c.policy_effective_from,'effective_to',c.policy_effective_to,
    'assignment_effective_from',c.assignment_effective_from,'assignment_effective_to',c.assignment_effective_to,
    'late_grace_minutes',c.late_grace_minutes,'very_late_minutes',c.very_late_minutes,
    'early_leave_grace_minutes',c.early_leave_grace_minutes,
    'shift_margin_before_minutes',c.shift_margin_before_minutes,'shift_margin_after_minutes',c.shift_margin_after_minutes,
    'expected_daily_hours',c.expected_daily_hours,'full_day_min_minutes',c.full_day_min_minutes,
    'half_day_min_minutes',c.half_day_min_minutes,'max_payable_minutes',c.max_payable_minutes,
    'auto_checkout_after_minutes',c.auto_checkout_after_minutes,
    'overtime_threshold_minutes',c.overtime_threshold_minutes,
    'overtime_requires_approval',c.overtime_requires_approval,'rounding_minutes',c.rounding_minutes,
    'core_start',c.core_start,'core_end',c.core_end,
    'permission_limit_per_cycle',c.permission_limit_per_cycle,'permission_max_minutes',c.permission_max_minutes,
    'weekly_off_allowance',c.weekly_off_allowance,'annual_leave_entitlement_days',c.annual_leave_entitlement_days,
    'notes',c.notes
  ) into v_result
  from candidates c
  order by c.priority,c.assignment_effective_from desc,c.policy_effective_from desc
  limit 1;

  return coalesce(v_result,'{}'::jsonb);
end;
$$;

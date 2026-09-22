
create or replace function public.payroll_finalization_gate_v1(
  p_staff_id uuid,
  p_month_cycle text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_username text;
  v_gate jsonb;
  v_engine jsonb;
  v_components jsonb;
  v_blockers jsonb:='[]'::jsonb;
  v_warnings jsonb:='[]'::jsonb;
  v_start date;
  v_end date;
  v_checked integer:=0;
  v_effective_changes integer:=0;
  v_candidate_changes integer:=0;
  v_enforce_days integer:=0;
  v_unresolved integer:=0;
  v_v3_materialized integer:=0;
  v_v3_pending integer:=0;
  v_identity_mismatch boolean:=false;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid_payroll_finalization_input' using errcode='22023';
  end if;

  select * into v_actor
  from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true
    and coalesce(can_login,false)=true;

  if not found then
    raise exception 'active staff actor required' using errcode='42501';
  end if;

  select sa.username
  into v_username
  from public.staff_accounts sa
  where sa.staff_id=p_staff_id::text
  order by coalesce(sa.active,true) desc,sa.created_at desc nulls last
  limit 1;

  if v_username is null
     or not public.dawaa_current_actor_can(array['manage_payroll'])
     or not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_payroll_finalization' using errcode='42501';
  end if;

  v_gate:=public.attendance_payroll_safety_gate_v1(p_staff_id,p_month_cycle);
  v_engine:=coalesce(v_gate->'engine','{}'::jsonb);
  v_components:=public.get_payroll_components_v17(p_staff_id,p_month_cycle);
  v_start:=nullif(v_engine->>'cycle_start','')::date;
  v_end:=nullif(v_engine->>'cycle_end','')::date;
  v_identity_mismatch:=coalesce((v_components->>'identity_branch_mismatch')::boolean,false);

  v_blockers:=coalesce(v_gate->'blockers','[]'::jsonb);
  v_warnings:=coalesce(v_gate->'warnings','[]'::jsonb);

  if v_identity_mismatch then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','identity_branch_mismatch',
      'label','فرع هوية الموظف لا يطابق فرع حسابه المالي'
    ));
  end if;

  if v_start is not null and v_end is not null then
    with eligible as (
      select a.staff_id,a.attendance_date
      from public.attendance_daily_summary a
      where a.staff_id=p_staff_id
        and a.attendance_date between v_start and v_end
    ), compared as (
      select e.*,
        public.dawaa_build_attendance_day_resolution_v2(e.staff_id,e.attendance_date) v2,
        public.dawaa_build_attendance_day_resolution_v3(e.staff_id,e.attendance_date) v3
      from eligible e
    )
    select
      count(*)::integer,
      count(*) filter (
        where v2->>'resolution_status' is distinct from v3->>'resolution_status'
      )::integer,
      count(*) filter (
        where coalesce((v3->>'policy_candidate_changed')::boolean,false)
      )::integer,
      count(*) filter (
        where v3->>'policy_rollout_mode'='enforce'
      )::integer,
      count(*) filter (
        where nullif(v3->>'resolved_policy_version','') is null
      )::integer
    into v_checked,v_effective_changes,v_candidate_changes,v_enforce_days,v_unresolved
    from compared;

    select
      count(*) filter(where coalesce(a.resolution_version,0)>=3)::integer,
      count(*) filter(where coalesce(a.resolution_version,0)>=3 and coalesce(a.status,'')<>'approved')::integer
    into v_v3_materialized,v_v3_pending
    from public.attendance_daily_summary a
    where a.staff_id=p_staff_id
      and a.attendance_date between v_start and v_end;
  end if;

  if v_effective_changes>0 then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','policy_v2_v3_mismatch',
      'label','يوجد اختلاف فعلي بين V2 وV3 داخل دورة المرتب',
      'count',v_effective_changes
    ));
  end if;

  if v_unresolved>0 then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','policy_unresolved_days',
      'label','يوجد أيام داخل الدورة بدون Policy محلولة',
      'count',v_unresolved
    ));
  end if;

  if v_v3_pending>0 then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','v3_pending_days',
      'label','يوجد أيام V3 materialized لكنها غير معتمدة',
      'count',v_v3_pending
    ));
  end if;

  if v_candidate_changes>0 and v_effective_changes=0 then
    v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object(
      'code','policy_candidate_changes',
      'label','يوجد أثر مرشح للسياسة يحتاج مراجعة قبل أي Cutover مالي',
      'count',v_candidate_changes
    ));
  end if;

  if v_enforce_days>0 and v_v3_materialized=0 then
    v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object(
      'code','enforce_not_materialized',
      'label','يوجد أيام Enforce حسب الـRollout لكن لم يتم Materialize V3 لها بعد',
      'count',v_enforce_days
    ));
  end if;

  return jsonb_build_object(
    'ready',
      jsonb_array_length(v_blockers)=0
      and coalesce((v_gate->>'ready')::boolean,false),
    'staff_id',p_staff_id,
    'staff_username',v_username,
    'month_cycle',p_month_cycle,
    'cycle_start',v_start,
    'cycle_end',v_end,
    'attendance_gate',v_gate,
    'payroll_components',v_components,
    'blockers',v_blockers,
    'warnings',v_warnings,
    'policy_validation',jsonb_build_object(
      'checked_days',v_checked,
      'effective_status_changes',v_effective_changes,
      'candidate_changes',v_candidate_changes,
      'enforce_days',v_enforce_days,
      'unresolved_policy_days',v_unresolved,
      'v3_materialized_days',v_v3_materialized,
      'v3_pending_days',v_v3_pending
    ),
    'generated_at',now()
  );
end;
$$;

revoke execute on function public.payroll_finalization_gate_v1(uuid,text) from public,anon;
grant execute on function public.payroll_finalization_gate_v1(uuid,text) to authenticated,service_role;

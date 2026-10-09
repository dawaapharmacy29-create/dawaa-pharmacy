create or replace function public.dawaa_payroll_policy_validation_for_staff_v1(
  p_staff_id uuid,
  p_cycle_start date,
  p_cycle_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_checked integer:=0;
  v_effective_changes integer:=0;
  v_candidate_changes integer:=0;
  v_enforce_days integer:=0;
  v_unresolved integer:=0;
  v_v3_materialized integer:=0;
  v_v3_pending integer:=0;
begin
  if p_staff_id is null or p_cycle_start is null or p_cycle_end is null or p_cycle_end<p_cycle_start then
    raise exception 'invalid_payroll_policy_validation_input' using errcode='22023';
  end if;

  with eligible as (
    select a.staff_id,a.attendance_date
    from public.attendance_daily_summary a
    where a.staff_id=p_staff_id
      and a.attendance_date between p_cycle_start and p_cycle_end
  ), compared as (
    select e.*,
      public.dawaa_build_attendance_day_resolution_v2(e.staff_id,e.attendance_date) v2,
      public.dawaa_build_attendance_day_resolution_v3(e.staff_id,e.attendance_date) v3
    from eligible e
  )
  select
    count(*)::integer,
    count(*) filter(where v2->>'resolution_status' is distinct from v3->>'resolution_status')::integer,
    count(*) filter(where coalesce((v3->>'policy_candidate_changed')::boolean,false))::integer,
    count(*) filter(where v3->>'policy_rollout_mode'='enforce')::integer,
    count(*) filter(where nullif(v3->>'resolved_policy_version','') is null)::integer
  into v_checked,v_effective_changes,v_candidate_changes,v_enforce_days,v_unresolved
  from compared;

  select
    count(*) filter(where coalesce(a.resolution_version,0)>=3)::integer,
    count(*) filter(where coalesce(a.resolution_version,0)>=3 and coalesce(a.status,'')<>'approved')::integer
  into v_v3_materialized,v_v3_pending
  from public.attendance_daily_summary a
  where a.staff_id=p_staff_id
    and a.attendance_date between p_cycle_start and p_cycle_end;

  return jsonb_build_object(
    'checked_days',coalesce(v_checked,0),
    'effective_status_changes',coalesce(v_effective_changes,0),
    'candidate_changes',coalesce(v_candidate_changes,0),
    'enforce_days',coalesce(v_enforce_days,0),
    'unresolved_policy_days',coalesce(v_unresolved,0),
    'v3_materialized_days',coalesce(v_v3_materialized,0),
    'v3_pending_days',coalesce(v_v3_pending,0)
  );
end;
$$;

revoke all on function public.dawaa_payroll_policy_validation_for_staff_v1(uuid,date,date) from public,anon,authenticated;
grant execute on function public.dawaa_payroll_policy_validation_for_staff_v1(uuid,date,date) to service_role;

create or replace function public.payroll_finalization_gate_v2(p_staff_id uuid,p_month_cycle text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_class jsonb;
  v_delivery jsonb;
  v_base jsonb;
  v_is_delivery boolean:=false;
  v_blockers jsonb:='[]'::jsonb;
  v_warnings jsonb:='[]'::jsonb;
  v_start date;
  v_end date;
  v_drift jsonb:='{}'::jsonb;
  v_unexplained_drift int:=0;
  v_explained_drift int:=0;
  v_mapping_warning text;
  v_mapping_conf text;
  v_policy_validation jsonb:='{}'::jsonb;
  v_effective_changes int:=0;
  v_candidate_changes int:=0;
  v_unresolved int:=0;
  v_v3_pending int:=0;
begin
  if p_staff_id is null or coalesce(trim(p_month_cycle),'') !~ '^\d{4}-(0[1-9]|1[0-2])$' then
    raise exception 'invalid_payroll_finalization_v2_input' using errcode='22023';
  end if;

  begin
    v_class:=public.dawaa_delivery_payroll_classification_v1(p_staff_id,p_month_cycle);
    v_is_delivery:=coalesce((v_class->>'payroll_eligible')::boolean,false);
  exception when others then
    v_is_delivery:=false;
  end;

  if not v_is_delivery then
    v_base:=public.payroll_finalization_gate_v1(p_staff_id,p_month_cycle);
    return v_base||jsonb_build_object('schema','payroll_finalization_gate_v2','delivery_gate_applied',false,'route','standard_v1');
  end if;

  if not public.dawaa_can_manage_payroll_staff_id_v1(p_staff_id) then
    raise exception 'not_authorized_for_delivery_payroll_finalization' using errcode='42501';
  end if;

  select cycle_start,cycle_end into v_start,v_end
  from public.dawaa_pay_cycle_bounds_v1(to_date(p_month_cycle||'-25','YYYY-MM-DD'));

  v_delivery:=public.dawaa_delivery_financial_preview_v2(p_staff_id,p_month_cycle);
  v_blockers:=coalesce(v_delivery->'blockers','[]'::jsonb);
  v_warnings:=coalesce(v_delivery->'warnings','[]'::jsonb);

  v_policy_validation:=public.dawaa_payroll_policy_validation_for_staff_v1(p_staff_id,v_start,v_end);
  v_effective_changes:=coalesce((v_policy_validation->>'effective_status_changes')::int,0);
  v_candidate_changes:=coalesce((v_policy_validation->>'candidate_changes')::int,0);
  v_unresolved:=coalesce((v_policy_validation->>'unresolved_policy_days')::int,0);
  v_v3_pending:=coalesce((v_policy_validation->>'v3_pending_days')::int,0);

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

  v_drift:=public.delivery_attendance_financial_drift_guard_v1(p_staff_id,v_start,v_end);
  v_unexplained_drift:=coalesce((v_drift->>'unexplained_drift_count')::int,0);
  v_explained_drift:=coalesce((v_drift->>'explained_override_count')::int,0);

  if v_unexplained_drift>0 then
    v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
      'code','delivery_attendance_unexplained_financial_drift',
      'label','يوجد اختلاف مالي غير مفسر بين الحضور المعتمد وإعادة البناء ويجب مراجعته قبل الإقفال',
      'count',v_unexplained_drift
    ));
  end if;

  if v_explained_drift>0 then
    v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object(
      'code','delivery_attendance_approved_override_drift',
      'label','يوجد اختلاف عن إعادة البناء الخام لكنه مفسر بقرار إداري/إذن/تعديل يدوي معتمد',
      'count',v_explained_drift
    ));
  end if;

  select m.identity_warning,m.confidence into v_mapping_warning,v_mapping_conf
  from public.delivery_payroll_identity_map_v1 m
  where m.staff_id=p_staff_id and m.active=true and m.mapping_status='approved'
    and m.effective_from<=v_end and (m.effective_to is null or m.effective_to>=v_start)
  order by m.effective_from desc,m.created_at desc limit 1;

  if v_mapping_warning is not null then
    v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object(
      'code','delivery_identity_warning','label',v_mapping_warning,'confidence',v_mapping_conf
    ));
  end if;

  return jsonb_build_object(
    'schema','payroll_finalization_gate_v2',
    'delivery_gate_applied',true,
    'route','delivery_v2',
    'staff_id',p_staff_id,
    'month_cycle',p_month_cycle,
    'cycle_start',v_start,
    'cycle_end',v_end,
    'attendance_gate',jsonb_build_object(
      'engine',public.dawaa_delivery_hours_truth_v1(p_staff_id,p_month_cycle),
      'ready',coalesce((v_delivery->>'ready_for_final')::boolean,false)
    ),
    'payroll_components',coalesce(v_delivery->'earnings_preview','{}'::jsonb),
    'delivery_gate',v_delivery,
    'policy_validation',v_policy_validation,
    'attendance_financial_drift_guard',v_drift,
    'blockers',v_blockers,
    'warnings',v_warnings,
    'ready',jsonb_array_length(v_blockers)=0 and coalesce((v_delivery->>'ready_for_final')::boolean,false),
    'generated_at',now()
  );
end;
$$;
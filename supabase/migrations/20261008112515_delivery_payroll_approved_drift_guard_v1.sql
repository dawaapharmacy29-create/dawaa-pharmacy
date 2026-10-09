create or replace function public.delivery_attendance_financial_drift_guard_v1(
  p_staff_id uuid,
  p_start date,
  p_end date
)
returns jsonb
language sql
stable security definer
set search_path to 'public','pg_catalog'
as $$
  with drift as (
    select
      a.id,
      a.attendance_date,
      a.resolution_status,
      coalesce(a.candidate_hours,0) stored_hours,
      coalesce((rebuilt.j->>'candidate_hours')::numeric,0) rebuilt_hours,
      a.resolution_origin,
      a.approved_by_name,
      a.approval_note,
      a.time_off_request_id,
      (
        coalesce(a.resolution_origin,'') like 'manual%'
        or coalesce(a.resolution_origin,'') in ('manager_decision','manual_manager_decision')
        or coalesce(a.approval_note,'') ~ '(قرار الإدارة|قرار المدير|بإذن|بدون خصم)'
        or (
          nullif(trim(coalesce(a.approved_by_name,'')),'') is not null
          and coalesce(a.approved_by_name,'') not in ('النظام التلقائي للحضور','النظام التلقائي','النظام')
        )
        or a.time_off_request_id is not null
        or exists(
          select 1
          from public.attendance_manual_actions_audit x
          where x.target_id=a.id
        )
      ) explained_by_approved_override
    from public.attendance_daily_summary a
    cross join lateral (
      select public.dawaa_build_attendance_day_resolution_v2(a.staff_id,a.attendance_date) j
    ) rebuilt
    where a.staff_id=p_staff_id
      and a.attendance_date between p_start and least(p_end,(now() at time zone 'Africa/Cairo')::date-1)
      and a.status='approved'
      and abs(coalesce(a.candidate_hours,0)-coalesce((rebuilt.j->>'candidate_hours')::numeric,0))>0.10
  )
  select jsonb_build_object(
    'staff_id',p_staff_id,
    'start_date',p_start,
    'end_date',p_end,
    'total_drift_count',count(*),
    'explained_override_count',count(*) filter(where explained_by_approved_override),
    'unexplained_drift_count',count(*) filter(where not explained_by_approved_override),
    'rows',coalesce(jsonb_agg(jsonb_build_object(
      'attendance_date',attendance_date,
      'resolution_status',resolution_status,
      'stored_hours',stored_hours,
      'rebuilt_hours',rebuilt_hours,
      'resolution_origin',resolution_origin,
      'approved_by_name',approved_by_name,
      'approval_note',approval_note,
      'time_off_request_id',time_off_request_id,
      'explained_by_approved_override',explained_by_approved_override
    ) order by attendance_date),'[]'::jsonb)
  )
  from drift;
$$;

create or replace function public.payroll_finalization_gate_v2(p_staff_id uuid,p_month_cycle text)
returns jsonb
language plpgsql
stable security definer
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
    'attendance_financial_drift_guard',v_drift,
    'blockers',v_blockers,
    'warnings',v_warnings,
    'ready',jsonb_array_length(v_blockers)=0 and coalesce((v_delivery->>'ready_for_final')::boolean,false),
    'generated_at',now()
  );
end;
$$;

revoke execute on function public.delivery_attendance_financial_drift_guard_v1(uuid,date,date) from public,anon,authenticated;
grant execute on function public.delivery_attendance_financial_drift_guard_v1(uuid,date,date) to service_role;

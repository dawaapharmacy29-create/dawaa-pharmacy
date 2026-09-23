-- Time Off Policy V3 preflight and reviewed decision wrapper.
-- Centralizes conflicts/balance/date-span checks before approval without changing historical records.

create or replace function public.time_off_request_preflight_v3(p_request_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_request public.staff_time_off_requests%rowtype;
  v_policy jsonb;
  v_blockers jsonb:='[]'::jsonb;
  v_warnings jsonb:='[]'::jsonb;
  v_days numeric:=0;
  v_balance jsonb;
  v_permission jsonb;
  v_overlap integer:=0;
  v_permission_overlap integer:=0;
  v_schedule record;
begin
  select * into v_request
  from public.staff_time_off_requests
  where id=p_request_id;

  if not found then raise exception 'time_off_request_not_found' using errcode='22023'; end if;
  if not public.dawaa_time_off_can_access_staff_v1(v_request.staff_id) then
    raise exception 'not_authorized_for_time_off_preflight' using errcode='42501';
  end if;

  v_policy:=public.get_attendance_policy_v1(v_request.start_date);

  if v_request.status<>'pending' then
    v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object(
      'code','request_not_pending','label','الطلب لم يعد قيد المراجعة','status',v_request.status
    ));
  end if;

  if v_request.request_kind='annual_leave' then
    if extract(year from v_request.start_date)<>extract(year from v_request.end_date) then
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
        'code','annual_leave_cross_year',
        'label','الإجازة السنوية لا تُعتمد عبر سنتين في طلب واحد؛ قسمها إلى طلبين حتى يُسجّل الرصيد في السنة الصحيحة'
      ));
    else
      v_days:=(v_request.end_date-v_request.start_date)+1;
      v_balance:=public.get_annual_leave_balance_v1(v_request.staff_id,extract(year from v_request.start_date)::int);
      if coalesce((v_balance->>'configured')::boolean,false) is not true
         and nullif(v_policy->>'annual_leave_entitlement_days','') is null then
        v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
          'code','annual_leave_not_configured',
          'label','استحقاق الإجازة السنوية غير مفعّل لهذا الموظف'
        ));
      elsif coalesce((v_policy->>'annual_leave_negative_balance_allowed')::boolean,false) is not true
        and coalesce((v_balance->>'configured')::boolean,false)
        and coalesce((v_balance->>'balance')::numeric,0)<v_days then
        v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
          'code','annual_leave_insufficient_balance',
          'label','رصيد الإجازة السنوية لا يكفي',
          'requested_days',v_days,
          'available_days',coalesce((v_balance->>'balance')::numeric,0)
        ));
      end if;
    end if;
  end if;

  if v_request.request_kind in ('annual_leave','sick_leave','exceptional_leave','approved_absence') then
    select count(*)::int into v_overlap
    from public.staff_time_off_requests r
    where r.staff_id=v_request.staff_id
      and r.id<>v_request.id
      and r.status='approved'
      and r.request_kind in ('annual_leave','sick_leave','exceptional_leave','approved_absence')
      and r.start_date<=v_request.end_date
      and r.end_date>=v_request.start_date;

    if v_overlap>0 then
      v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
        'code','overlapping_approved_full_day_timeoff',
        'label','يوجد طلب إجازة/غياب معتمد متداخل مع نفس الفترة',
        'count',v_overlap
      ));
    end if;
  end if;

  if v_request.request_kind='permission' then
    v_permission:=public.get_permission_policy_status_v2(
      v_request.staff_id,
      public.dawaa_points_cycle_start_for_label_v1(public.dawaa_points_cycle_label_for_date_v3(v_request.start_date)),
      public.dawaa_points_cycle_end_for_label_v1(public.dawaa_points_cycle_label_for_date_v3(v_request.start_date))
    );

    if coalesce(v_request.duration_minutes,0)>coalesce((v_permission->>'max_minutes_per_permission')::int,120) then
      v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object(
        'code','permission_over_single_limit',
        'label','مدة الإذن تتجاوز الحد المعتاد وتحتاج صلاحية الإدارة العليا',
        'duration_minutes',v_request.duration_minutes,
        'limit_minutes',(v_permission->>'max_minutes_per_permission')::int
      ));
    end if;
    if coalesce((v_permission->>'remaining')::int,0)<=0 then
      v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object(
        'code','permission_cycle_allowance_exhausted',
        'label','تم استهلاك عدد الأذونات المسموح به في الدورة؛ الاعتماد يحتاج إدارة عليا'
      ));
    end if;

    if v_request.start_time is not null and v_request.end_time is not null then
      select count(*)::int into v_permission_overlap
      from public.staff_time_off_requests r
      where r.staff_id=v_request.staff_id
        and r.id<>v_request.id
        and r.status='approved'
        and r.request_kind='permission'
        and r.start_date=v_request.start_date
        and r.start_time is not null and r.end_time is not null
        and (
          (v_request.start_time<v_request.end_time and r.start_time<r.end_time
            and v_request.start_time<r.end_time and r.start_time<v_request.end_time)
          or (v_request.start_time>=v_request.end_time)
          or (r.start_time>=r.end_time)
        );

      if v_permission_overlap>0 then
        v_blockers:=v_blockers||jsonb_build_array(jsonb_build_object(
          'code','overlapping_approved_permission',
          'label','يوجد إذن معتمد متداخل زمنيًا في نفس اليوم',
          'count',v_permission_overlap
        ));
      end if;
    end if;
  end if;

  if v_request.request_kind='shift_swap' then
    select * into v_schedule
    from public.attendance_schedule_for_date_v1(v_request.staff_id,v_request.start_date)
    limit 1;

    if v_schedule.schedule_id is null or coalesce(v_schedule.source_kind,'')<>'date_override' then
      v_warnings:=v_warnings||jsonb_build_array(jsonb_build_object(
        'code','shift_swap_schedule_override_missing',
        'label','تبديل الشيفت يحتاج Date Override في الجدول قبل أن يصبح Attendance Truth قابلاً للإغلاق'
      ));
    end if;
  end if;

  return jsonb_build_object(
    'request_id',v_request.id,
    'staff_id',v_request.staff_id,
    'staff_name',v_request.staff_name_snapshot,
    'request_kind',v_request.request_kind,
    'status',v_request.status,
    'start_date',v_request.start_date,
    'end_date',v_request.end_date,
    'allowed',jsonb_array_length(v_blockers)=0,
    'blockers',v_blockers,
    'warnings',v_warnings,
    'policy_version',coalesce(v_policy->>'policy_code','unconfigured'),
    'annual_leave_balance',v_balance,
    'permission_policy',v_permission,
    'generated_at',now()
  );
end;
$$;

create or replace function public.decide_staff_time_off_request_v3(
  p_request_id uuid,
  p_decision text,
  p_note text default null
)
returns public.staff_time_off_requests
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_preflight jsonb;
begin
  if lower(trim(coalesce(p_decision,''))) not in ('approved','rejected') then
    raise exception 'invalid_time_off_decision' using errcode='22023';
  end if;

  if lower(trim(p_decision))='approved' then
    v_preflight:=public.time_off_request_preflight_v3(p_request_id);
    if coalesce((v_preflight->>'allowed')::boolean,false) is not true then
      raise exception 'time_off_preflight_blocked: %',v_preflight->'blockers' using errcode='55000';
    end if;
  end if;

  return public.decide_staff_time_off_request_v1(p_request_id,lower(trim(p_decision)),p_note);
end;
$$;

revoke execute on function public.time_off_request_preflight_v3(uuid) from public;
revoke execute on function public.decide_staff_time_off_request_v3(uuid,text,text) from public;
grant execute on function public.time_off_request_preflight_v3(uuid) to anon,authenticated,service_role;
grant execute on function public.decide_staff_time_off_request_v3(uuid,text,text) to anon,authenticated,service_role;

-- Direct full-day time-off approval from Attendance Resolution Center.
-- Covers sick leave, exceptional leave, and approved absence without requiring
-- a separate pre-created request. Uses the canonical time-off preflight/decision path.

create or replace function public.approve_attendance_full_day_timeoff_v1(
  p_staff_id uuid,
  p_date date,
  p_request_kind text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_request public.staff_time_off_requests%rowtype;
  v_attendance public.attendance_daily_summary%rowtype;
  v_label text;
  v_reason text;
begin
  if p_staff_id is null or p_date is null then
    raise exception 'full_day_timeoff_identity_or_date_missing' using errcode='22023';
  end if;

  if p_request_kind not in ('sick_leave','exceptional_leave','approved_absence') then
    raise exception 'unsupported_attendance_full_day_timeoff_kind' using errcode='22023';
  end if;

  if not public.dawaa_time_off_can_decide_staff_v1(p_staff_id) then
    raise exception 'not_authorized_for_full_day_timeoff_decision' using errcode='42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_staff_id::text||':'||p_date::text||':'||p_request_kind,0
  ));

  v_label:=case p_request_kind
    when 'sick_leave' then 'إجازة مرضية'
    when 'exceptional_leave' then 'إجازة عارضة'
    else 'غياب بإذن'
  end;
  v_reason:=coalesce(nullif(trim(coalesce(p_note,'')),''),
    v_label||' اعتمدت من صندوق مراجعة الحضور');

  select * into v_attendance
  from public.attendance_daily_summary a
  where a.staff_id=p_staff_id and a.attendance_date=p_date
  order by a.updated_at desc
  limit 1
  for update;

  if v_attendance.id is null then
    raise exception 'attendance_day_not_materialized' using errcode='55000';
  end if;

  select * into v_request
  from public.staff_time_off_requests r
  where r.staff_id=p_staff_id
    and r.request_kind=p_request_kind
    and r.status in ('approved','pending')
    and r.start_date<=p_date
    and r.end_date>=p_date
  order by (r.status='approved') desc,r.created_at desc
  limit 1
  for update;

  if v_request.id is null then
    v_request:=public.create_staff_time_off_request_v1(
      p_staff_id,p_request_kind,v_label,p_date,p_date,
      null,null,null,v_reason
    );
  end if;

  if v_request.status='pending' then
    v_request:=public.decide_staff_time_off_request_v3(
      v_request.id,'approved',v_reason
    );
  end if;

  v_attendance:=public.dawaa_materialize_attendance_day_internal_v2(
    p_staff_id,p_date
  );

  return jsonb_build_object(
    'success',true,
    'request_id',v_request.id,
    'request_kind',v_request.request_kind,
    'request_label',coalesce(v_request.request_label,v_label),
    'request_status',v_request.status,
    'attendance_status',v_attendance.status,
    'resolution_status',v_attendance.resolution_status,
    'date',p_date
  );
end;
$$;

revoke execute on function public.approve_attendance_full_day_timeoff_v1(uuid,date,text,text) from public;
grant execute on function public.approve_attendance_full_day_timeoff_v1(uuid,date,text,text)
to anon,authenticated,service_role;

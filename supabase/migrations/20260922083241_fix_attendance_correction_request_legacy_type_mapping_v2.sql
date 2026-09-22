CREATE OR REPLACE FUNCTION public.create_my_attendance_correction_request_v2(p_attendance_date date, p_request_kind text, p_requested_time timestamp with time zone, p_reason text)
 RETURNS attendance_manual_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_account_id uuid;
  v_staff_id uuid;
  v_staff public.staff%rowtype;
  v_kind text:=lower(trim(coalesce(p_request_kind,'')));
  v_legacy_type text;
  v_row public.attendance_manual_requests%rowtype;
begin
  v_account_id:=public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then
    raise exception 'active staff actor required' using errcode='42501';
  end if;

  select nullif(sa.staff_id,'')::uuid into v_staff_id
  from public.staff_accounts sa
  where sa.id=v_account_id and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true;

  if v_staff_id is null then
    begin
      select id into v_staff_id from public.staff where id=v_account_id limit 1;
    exception when others then
      v_staff_id:=null;
    end;
  end if;

  if v_staff_id is null then
    raise exception 'account_not_linked_to_staff' using errcode='22023';
  end if;

  select * into v_staff from public.staff where id=v_staff_id;
  if not found then raise exception 'staff_not_found' using errcode='22023'; end if;

  if p_attendance_date is null
     or p_attendance_date>(now() at time zone 'Africa/Cairo')::date
     or p_attendance_date<((now() at time zone 'Africa/Cairo')::date-62) then
    raise exception 'invalid_correction_date' using errcode='22023';
  end if;

  if v_kind not in ('missing_checkin','missing_checkout','wrong_time','other') then
    raise exception 'invalid_correction_kind' using errcode='22023';
  end if;

  v_legacy_type:=case v_kind
    when 'missing_checkin' then 'missed_check_in'
    when 'missing_checkout' then 'missed_check_out'
    when 'wrong_time' then 'biometric_issue'
    else 'other'
  end;

  if p_requested_time is null and v_kind<>'other' then
    raise exception 'requested_time_required' using errcode='22023';
  end if;

  if length(trim(coalesce(p_reason,'')))<5 then
    raise exception 'correction_reason_too_short' using errcode='22023';
  end if;

  if exists(
    select 1 from public.attendance_manual_requests r
    where r.staff_id=v_staff_id
      and coalesce(r.attendance_date,(r.requested_time at time zone 'Africa/Cairo')::date)=p_attendance_date
      and coalesce(r.request_kind,
        case r.request_type
          when 'missed_check_in' then 'missing_checkin'
          when 'missed_check_out' then 'missing_checkout'
          when 'biometric_issue' then 'wrong_time'
          else r.request_type
        end
      )=v_kind
      and r.status='pending'
  ) then
    raise exception 'duplicate_pending_correction_request' using errcode='23505';
  end if;

  insert into public.attendance_manual_requests(
    staff_id,staff_name,branch_name,request_type,request_kind,attendance_date,requested_time,reason,status,created_at,updated_at
  )
  values(
    v_staff_id,v_staff.name,v_staff.branch,v_legacy_type,v_kind,p_attendance_date,
    coalesce(p_requested_time,(p_attendance_date::timestamp+time '12:00') at time zone 'Africa/Cairo'),
    trim(p_reason),'pending',now(),now()
  )
  returning * into v_row;

  return v_row;
end;
$function$


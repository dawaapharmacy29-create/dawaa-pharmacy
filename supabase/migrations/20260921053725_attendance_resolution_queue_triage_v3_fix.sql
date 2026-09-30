CREATE OR REPLACE FUNCTION public.get_attendance_resolution_queue_v3(p_start date, p_end date, p_branch text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_triage text DEFAULT 'all'::text, p_limit integer DEFAULT 300)
 RETURNS SETOF attendance_daily_summary
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_actor public.staff_accounts%rowtype;
begin
  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;

  if not found then
    raise exception 'active staff actor required' using errcode='42501';
  end if;

  return query
  with base as (
    select
      a as row_data,
      (
        select count(*)::int
        from public.biometric_attendance_logs bl
        where bl.staff_id=a.staff_id
          and (
            (a.scheduled_start_at is not null and a.scheduled_end_at is not null
             and bl.punch_time between a.scheduled_start_at-interval '4 hours'
                                   and a.scheduled_end_at+interval '6 hours')
            or
            ((a.scheduled_start_at is null or a.scheduled_end_at is null)
             and (bl.punch_time at time zone 'Africa/Cairo')::date between a.attendance_date and a.attendance_date+1)
          )
      ) raw_events
    from public.attendance_daily_summary a
    where a.attendance_date between p_start and p_end
      and coalesce(a.resolution_version,0)>=2
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or a.branch=p_branch)
      and (p_status is null or trim(p_status)='' or a.status=p_status)
      and public.dawaa_can_read_staff_attendance_log(a.staff_id,a.branch)
  )
  select (b.row_data).*
  from base b
  where
    coalesce(p_triage,'all')='all'
    or (
      p_triage='system'
      and (b.row_data).status='pending_review'
      and (b.row_data).resolution_status in ('missing_checkin','missing_checkout','absence_review')
      and b.raw_events>=2
    )
    or (
      p_triage='manager'
      and not (
        (b.row_data).status='pending_review'
        and (b.row_data).resolution_status in ('missing_checkin','missing_checkout','absence_review')
        and b.raw_events>=2
      )
    )
  order by
    case when (b.row_data).status='pending_review' then 0 else 1 end,
    case when (b.row_data).status<>'pending_review' then 99 else
      case (b.row_data).resolution_status
        when 'missing_checkin' then 1
        when 'missing_checkout' then 1
        when 'invalid_duration' then 2
        when 'worked_on_off' then 3
        when 'early_leave_review' then 4
        when 'needs_event_review' then 5
        when 'absence_review' then 5
        when 'no_schedule' then 6
        else 8
      end
    end,
    (b.row_data).attendance_date desc,
    (b.row_data).branch,
    (b.row_data).staff_id
  limit greatest(1,least(coalesce(p_limit,300),1000));
end;
$function$


grant execute on function public.get_attendance_resolution_queue_v3(date,date,text,text,text,integer)
  to anon,authenticated,service_role;

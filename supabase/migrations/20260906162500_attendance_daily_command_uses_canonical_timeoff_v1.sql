-- Keep the public function signature stable, but remove legacy name-based
-- shift_exceptions matching from attendance truth. Approved exceptions now come
-- from staff_time_off_requests by canonical staff_id, and lateness thresholds
-- come from attendance_policy_versions.

create or replace function public.attendance_daily_command_v1(p_date date default ((now() at time zone 'Africa/Cairo')::date),p_branch text default null)
returns table(staff_id uuid,staff_name text,role text,branch text,work_date date,schedule_status text,shift_start time,shift_end time,first_check_in timestamptz,last_check_out timestamptz,late_minutes integer,early_leave_minutes integer,attendance_status text,approved_exception_type text,approved_exception_reason text,biometric_events integer,source_status text)
language plpgsql stable security definer
set search_path='public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_day_name text;
  v_complete_through timestamptz;
  v_policy jsonb:=public.get_attendance_policy_v1(p_date);
  v_late_grace integer:=coalesce((v_policy->>'late_grace_minutes')::int,15);
  v_very_late integer:=coalesce((v_policy->>'very_late_minutes')::int,30);
begin
  select * into v_actor from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true;
  if not found then raise exception using errcode='42501',message='active staff actor required'; end if;

  v_complete_through:=public.attendance_sync_complete_through_v1('fingerprint_vendor_primary');
  v_day_name:=case extract(dow from p_date)::int when 0 then 'الأحد' when 1 then 'الاثنين' when 2 then 'الثلاثاء' when 3 then 'الأربعاء' when 4 then 'الخميس' when 5 then 'الجمعة' else 'السبت' end;

  return query
  with canonical_staff as (
    select s.id,s.name,s.role,s.branch from public.staff s
    where coalesce(s.active,false)=true and s.branch in ('فرع الشامي','فرع شكري')
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or s.branch=p_branch)
      and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
  ), schedule_pick as (
    select cs.id staff_id,
      case when trim(coalesce(ss.shift_start,''))~'^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$' then trim(ss.shift_start)::time else ss.start_time end shift_start,
      case when trim(coalesce(ss.shift_end,''))~'^([01]?\d|2[0-3]):[0-5]\d(:[0-5]\d)?$' then trim(ss.shift_end)::time else ss.end_time end shift_end,
      coalesce(ss.is_off,false) is_off,coalesce(ss.is_day_off,false) is_day_off,ss.id schedule_id
    from canonical_staff cs
    left join lateral (
      select x.* from public.shift_schedules x
      where x.staff_id=cs.id and (coalesce(x.shift_date,x.date)=p_date or (x.shift_date is null and x.date is null and trim(coalesce(x.day_name,''))=v_day_name))
      order by (coalesce(x.shift_date,x.date)=p_date) desc,coalesce(x.updated_at,x.created_at) desc nulls last,x.id desc limit 1
    ) ss on true
  ), exceptions as (
    select cs.id staff_id,e.request_label as type,e.reason from canonical_staff cs
    left join lateral (
      select coalesce(x.request_label,x.request_kind) request_label,x.reason from public.staff_time_off_requests x
      where x.staff_id=cs.id and x.status='approved'
        and x.request_kind in ('permission','annual_leave','sick_leave','exceptional_leave','approved_absence')
        and p_date between x.start_date and x.end_date
      order by x.decided_at desc nulls last,x.updated_at desc,x.id desc limit 1
    ) e on true
  ), base as (
    select cs.id,cs.name,cs.role,cs.branch,sp.shift_start,sp.shift_end,sp.is_off,sp.is_day_off,sp.schedule_id,ex.type exception_type,ex.reason exception_reason,
      case when sp.schedule_id is null then 'missing'
           when (sp.is_off or sp.is_day_off) and sp.shift_start is not null and sp.shift_end is not null then 'conflict'
           when (sp.is_off or sp.is_day_off) then 'off'
           when sp.shift_start is null or sp.shift_end is null then 'missing_time' else 'scheduled' end schedule_state
    from canonical_staff cs left join schedule_pick sp on sp.staff_id=cs.id left join exceptions ex on ex.staff_id=cs.id
  ), scheduled as (
    select b.*,
      case when b.schedule_state='scheduled' then (p_date::timestamp+b.shift_start) at time zone 'Africa/Cairo' end scheduled_start,
      case when b.schedule_state='scheduled' then (((p_date+case when b.shift_end<=b.shift_start then 1 else 0 end)::timestamp+b.shift_end) at time zone 'Africa/Cairo') end scheduled_end
    from base b
  ), with_punches as (
    select s.*,p.first_in,p.last_out,coalesce(p.event_count,0) event_count from scheduled s
    left join lateral (
      select min(l.recorded_at) filter(where l.attendance_type='check_in') first_in,
             max(l.recorded_at) filter(where l.attendance_type='check_out') last_out,
             count(*)::int event_count
      from public.staff_attendance_logs l
      where l.staff_id=s.id and l.status='accepted' and ((s.schedule_state='scheduled' and l.recorded_at>=s.scheduled_start-interval '4 hours' and l.recorded_at<=s.scheduled_end+interval '6 hours') or (s.schedule_state<>'scheduled' and l.shift_date=p_date))
    ) p on true
  )
  select c.id,c.name,c.role,c.branch,p_date,c.schedule_state,c.shift_start,c.shift_end,c.first_in,c.last_out,
    case when c.schedule_state<>'scheduled' or c.first_in is null then 0 else greatest(0,floor(extract(epoch from(c.first_in-c.scheduled_start))/60)::int) end,
    case when c.schedule_state<>'scheduled' or c.last_out is null then 0 else greatest(0,floor(extract(epoch from(c.scheduled_end-c.last_out))/60)::int) end,
    case
      when c.schedule_state='conflict' then 'schedule_conflict'
      when c.schedule_state='off' and c.event_count>0 then 'worked_on_off'
      when c.schedule_state='off' then 'off'
      when c.schedule_state in ('missing','missing_time') and c.event_count>0 then 'punch_without_valid_schedule'
      when c.schedule_state in ('missing','missing_time') then 'schedule_missing'
      when c.exception_type is not null and c.event_count=0 then 'approved_exception'
      when c.first_in is null and (v_complete_through is null or v_complete_through<c.scheduled_end) then 'sync_pending'
      when c.first_in is null and p_date<(now() at time zone 'Africa/Cairo')::date then 'absent'
      when c.first_in is null and p_date=(now() at time zone 'Africa/Cairo')::date and now()>c.scheduled_start+(v_late_grace||' minutes')::interval then 'not_arrived'
      when c.first_in is null then 'scheduled'
      when c.last_out is null and (v_complete_through is null or v_complete_through<c.scheduled_end) then 'sync_pending_checkout'
      when c.last_out is null and (p_date<(now() at time zone 'Africa/Cairo')::date or now()>c.scheduled_end+interval '6 hours') then 'missing_checkout'
      when c.last_out is null then 'working_now'
      when c.first_in>c.scheduled_start+(v_very_late||' minutes')::interval then 'very_late'
      when c.first_in>c.scheduled_start+(v_late_grace||' minutes')::interval then 'late'
      else 'on_time' end,
    c.exception_type,c.exception_reason,c.event_count,
    case when c.event_count>0 then 'fingerprint' when v_complete_through is null or (c.scheduled_end is not null and v_complete_through<c.scheduled_end) then 'sync_pending' else 'schedule' end
  from with_punches c
  where c.schedule_id is not null or c.event_count>0 or c.exception_type is not null
  order by c.branch,c.name;
end;
$$;

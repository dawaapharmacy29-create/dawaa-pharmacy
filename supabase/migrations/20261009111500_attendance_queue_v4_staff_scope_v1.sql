-- Align canonical Attendance Resolution Queue V4 with staff-branch scope.
-- Historical summary.branch remains evidence only and must not remove a staff member
-- from their canonical Shamy/Shokry operational scope.

create or replace function public.get_attendance_resolution_queue_v4(
  p_start date,
  p_end date,
  p_branch text default null,
  p_status text default null,
  p_triage text default 'all',
  p_limit integer default 300
)
returns setof public.attendance_daily_summary
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_triage text:=lower(trim(coalesce(p_triage,'all')));
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>45 then
    raise exception 'attendance_resolution_queue_v4_invalid_range' using errcode='22023';
  end if;
  if v_triage not in ('all','system','manager','waiting') then
    raise exception 'attendance_resolution_queue_v4_invalid_triage' using errcode='22023';
  end if;

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
      s.branch as staff_branch,
      case when a.status='pending_review'
        then public.dawaa_build_attendance_day_resolution_current_v1(a.staff_id,a.attendance_date)
        else null::jsonb
      end as preview
    from public.attendance_daily_summary a
    join public.staff s on s.id=a.staff_id
    where a.attendance_date between p_start and p_end
      and coalesce(a.resolution_version,0)>=2
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or trim(s.branch)=trim(p_branch))
      and (p_status is null or trim(p_status)='' or a.status=p_status)
      and public.dawaa_can_read_staff_attendance_log(a.staff_id,s.branch)
  )
  select (b.row_data).*
  from base b
  where
    v_triage='all'
    or (
      v_triage='system'
      and (b.row_data).status='pending_review'
      and coalesce((b.preview->>'finalizable')::boolean,false)=true
      and coalesce((b.preview->>'system_resolvable')::boolean,false)=true
    )
    or (
      v_triage='manager'
      and (b.row_data).status='pending_review'
      and coalesce((b.preview->>'finalizable')::boolean,false)=true
      and coalesce((b.preview->>'system_resolvable')::boolean,false)=false
    )
    or (
      v_triage='waiting'
      and (b.row_data).status='pending_review'
      and coalesce((b.preview->>'finalizable')::boolean,false)=false
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
    b.staff_branch,
    (b.row_data).staff_id
  limit greatest(1,least(coalesce(p_limit,300),1000));
end;
$function$;

revoke all on function public.get_attendance_resolution_queue_v4(date,date,text,text,text,integer) from public;
grant execute on function public.get_attendance_resolution_queue_v4(date,date,text,text,text,integer)
to anon,authenticated,service_role;

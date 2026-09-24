-- Cross-branch biometric diagnostics V2
-- Uses the schedule-effective branch for the punch date as the operational expectation.
-- Falls back to the employee's current staff.branch only when no schedule exists.
-- Read-only diagnostic: does not mutate attendance truth, schedule, payroll, or biometric data.

create or replace function public.list_cross_branch_biometric_events_v2(
  p_start date,
  p_end date,
  p_branch text default null,
  p_limit integer default 250
)
returns table(
  staff_id uuid,
  staff_name text,
  role text,
  home_branch text,
  expected_branch text,
  punch_branch text,
  expected_source text,
  biometric_user_id text,
  punch_time timestamptz,
  punch_type text,
  device_id text,
  provider text
)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>45 then
    raise exception 'invalid_cross_branch_range' using errcode='22023';
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
  with normalized as (
    select
      b.*,
      public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time) as event_at,
      public.dawaa_biometric_source_branch_v1(b.raw_payload,b.branch) as source_branch
    from public.biometric_attendance_logs b
    where (public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)
           at time zone 'Africa/Cairo')::date between p_start and p_end
  ),
  resolved as (
    select
      s.id as staff_id,
      s.name as staff_name,
      s.role,
      nullif(trim(s.branch),'') as home_branch,
      coalesce(nullif(trim(sch.branch),''),nullif(trim(s.branch),'')) as expected_branch,
      nullif(trim(n.source_branch),'') as punch_branch,
      case
        when sch.schedule_id is not null then 'schedule_'||coalesce(sch.source_kind,'resolved')
        else 'staff_current_fallback'
      end as expected_source,
      n.biometric_user_id,
      n.event_at as punch_time,
      n.punch_type,
      n.device_id::text as device_id,
      n.provider
    from normalized n
    join public.staff s on s.id=n.staff_id
    left join lateral public.attendance_schedule_for_date_v1(
      s.id,
      (n.event_at at time zone 'Africa/Cairo')::date
    ) sch on true
  )
  select
    r.staff_id,r.staff_name,r.role,r.home_branch,r.expected_branch,r.punch_branch,
    r.expected_source,r.biometric_user_id,r.punch_time,r.punch_type,r.device_id,r.provider
  from resolved r
  where r.expected_branch is not null
    and r.punch_branch is not null
    and r.punch_branch<>r.expected_branch
    and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or r.expected_branch=trim(p_branch))
    and public.dawaa_can_read_staff_attendance_log(r.staff_id,r.expected_branch)
  order by r.punch_time desc,r.staff_name
  limit greatest(1,least(coalesce(p_limit,250),1000));
end;
$$;

revoke execute on function public.list_cross_branch_biometric_events_v2(date,date,text,integer) from public;
grant execute on function public.list_cross_branch_biometric_events_v2(date,date,text,integer)
  to anon,authenticated,service_role;

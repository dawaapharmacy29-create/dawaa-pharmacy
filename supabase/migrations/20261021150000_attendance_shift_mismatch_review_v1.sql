-- Read-only shift-mismatch evidence for manager review; never auto-approve or alter punch truth.
create or replace function public.attendance_shift_mismatch_review_v1(
  p_start date,
  p_end date,
  p_branch text default null,
  p_limit integer default 150
)
returns table(
  staff_id uuid, staff_name text, staff_role text, branch text,
  punch_date date, raw_events integer, review_events integer,
  fallback_accepted integer, first_punch timestamptz, last_punch timestamptz,
  scheduled_start_at timestamptz, scheduled_end_at timestamptz
)
language plpgsql stable security definer
set search_path to 'public','pg_catalog'
as $$
begin
  if p_start is null or p_end is null or p_end < p_start or p_end-p_start > 62 then
    raise exception 'invalid_shift_mismatch_review_range' using errcode='22023';
  end if;
  if public.dawaa_current_staff_account_id_strict() is null then
    raise exception 'attendance_shift_mismatch_unauthorized' using errcode='42501';
  end if;
  return query
  with evidence as (
    select
      d.staff_id,
      s.name as staff_name,
      s.role as staff_role,
      s.branch,
      (public.dawaa_fingerprint_effective_time_v1(bl.provider,bl.raw_payload,bl.punch_time)
        at time zone 'Africa/Cairo')::date as punch_date,
      bl.id,
      d.decision,
      public.dawaa_fingerprint_effective_time_v1(bl.provider,bl.raw_payload,bl.punch_time) as effective_at
    from public.biometric_semantic_decisions d
    join public.biometric_attendance_logs bl on bl.id=d.biometric_log_id
    join public.staff s on s.id=d.staff_id
    where d.reason='no_matching_schedule_fallback_to_raw'
      and public.dawaa_fingerprint_effective_time_v1(bl.provider,bl.raw_payload,bl.punch_time)
        >= (p_start::timestamp at time zone 'Africa/Cairo')
      and public.dawaa_fingerprint_effective_time_v1(bl.provider,bl.raw_payload,bl.punch_time)
        < ((p_end+2)::timestamp at time zone 'Africa/Cairo')
      and (p_branch is null or trim(p_branch)='' or p_branch='الكل'
        or trim(s.branch)=trim(p_branch))
      and public.dawaa_can_read_staff_attendance_log(s.id,s.branch)
  ), grouped as (
    select e.staff_id, max(e.staff_name) staff_name, max(e.staff_role) staff_role,
      max(e.branch) branch, e.punch_date,
      count(*)::integer raw_events,
      count(*) filter(where e.decision='review')::integer review_events,
      count(*) filter(where e.decision='accepted')::integer fallback_accepted,
      min(e.effective_at) first_punch, max(e.effective_at) last_punch
    from evidence e
    where e.punch_date between p_start and p_end
    group by e.staff_id,e.punch_date
  )
  select g.staff_id,g.staff_name,g.staff_role,g.branch,g.punch_date,
    g.raw_events,g.review_events,g.fallback_accepted,g.first_punch,g.last_punch,
    (g.punch_date::timestamp+sch.shift_start) at time zone 'Africa/Cairo',
    ((g.punch_date+case when sch.shift_end<=sch.shift_start then 1 else 0 end)::timestamp+sch.shift_end)
      at time zone 'Africa/Cairo'
  from grouped g
  left join lateral public.attendance_schedule_for_date_v1(g.staff_id,g.punch_date) sch on true
  order by g.raw_events desc,g.punch_date desc
  limit greatest(1,least(coalesce(p_limit,150),500));
end;
$$;
revoke all on function public.attendance_shift_mismatch_review_v1(date,date,text,integer) from public;
grant execute on function public.attendance_shift_mismatch_review_v1(date,date,text,integer) to authenticated,service_role;
notify pgrst,'reload schema';

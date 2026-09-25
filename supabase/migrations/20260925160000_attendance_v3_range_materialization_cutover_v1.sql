-- Attendance V3 range materialization cutover.
-- Approved historical rows are immutable Attendance Truth and are never rewritten.
-- Open rows are rematerialized through V3; V2 range becomes a compatibility wrapper.

create or replace function public.dawaa_materialize_attendance_range_internal_v3(
  p_start date,
  p_end date,
  p_branch text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_d date;
  v_staff record;
  v_row public.attendance_daily_summary%rowtype;
  v_processed integer:=0;
  v_approved integer:=0;
  v_review integer:=0;
  v_v3_rows integer:=0;
  v_frozen_approved integer:=0;
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>45 then
    raise exception 'attendance_materialize_invalid_range' using errcode='22023';
  end if;

  for v_d in select generate_series(p_start,p_end,interval '1 day')::date loop
    for v_staff in
      select s.id
      from public.staff s
      where coalesce(s.active,false)=true
        and s.branch in ('فرع الشامي','فرع شكري')
        and (
          p_branch is null or trim(p_branch)='' or p_branch='الكل'
          or s.branch=p_branch
        )
    loop
      -- Approved rows are frozen truth and V3 internal returns them unchanged.
      v_row:=public.dawaa_materialize_attendance_day_internal_v3(v_staff.id,v_d);

      if v_row.id is not null then
        v_processed:=v_processed+1;
        if v_row.status='approved' then
          v_approved:=v_approved+1;
          if coalesce(v_row.resolution_version,0)<3 then
            v_frozen_approved:=v_frozen_approved+1;
          end if;
        elsif v_row.status='pending_review' then
          v_review:=v_review+1;
        end if;
        if coalesce(v_row.resolution_version,0)>=3 then
          v_v3_rows:=v_v3_rows+1;
        end if;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'processed',v_processed,
    'approved',v_approved,
    'pending_review',v_review,
    'v3_rows',v_v3_rows,
    'frozen_approved_legacy',v_frozen_approved,
    'start',p_start,
    'end',p_end,
    'branch',p_branch,
    'resolution_version',3,
    'approved_truth_policy','approved rows remain immutable'
  );
end;
$function$;

create or replace function public.materialize_attendance_range_v3(
  p_start date,
  p_end date,
  p_branch text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor public.staff_accounts%rowtype;
begin
  select * into v_actor
  from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true
    and coalesce(sa.can_login,false)=true;

  if not found
     or not public.dawaa_current_actor_can(array['manage_attendance','manage_hr','manage_payroll']) then
    raise exception 'not_authorized_for_attendance_materialization' using errcode='42501';
  end if;

  return public.dawaa_materialize_attendance_range_internal_v3(p_start,p_end,p_branch);
end;
$function$;

-- Compatibility wrapper: no application path can accidentally rematerialize through V2.
create or replace function public.materialize_attendance_range_v2(
  p_start date,
  p_end date,
  p_branch text default null
)
returns jsonb
language sql
security definer
set search_path to 'public','pg_catalog'
as $function$
  select public.materialize_attendance_range_v3(p_start,p_end,p_branch);
$function$;

revoke execute on function public.dawaa_materialize_attendance_range_internal_v2(date,date,text)
  from public,anon,authenticated;
revoke execute on function public.dawaa_materialize_attendance_day_internal_v2(uuid,date)
  from public,anon,authenticated;
revoke execute on function public.dawaa_materialize_attendance_range_internal_v3(date,date,text)
  from public,anon,authenticated;

grant execute on function public.materialize_attendance_range_v3(date,date,text)
  to authenticated,service_role;
grant execute on function public.materialize_attendance_range_v2(date,date,text)
  to authenticated,service_role;
grant execute on function public.dawaa_materialize_attendance_range_internal_v3(date,date,text)
  to service_role;

comment on function public.materialize_attendance_range_v2(date,date,text)
  is 'COMPATIBILITY WRAPPER: canonical attendance range materialization is V3.';

create or replace function public.attendance_policy_v3_cutover_readiness_v1(
  p_start date default null,
  p_end date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_start date;
  v_end date;
  v_total integer:=0;
  v_effective integer:=0;
  v_candidate integer:=0;
  v_unresolved integer:=0;
  v_open integer:=0;
  v_open_v3 integer:=0;
  v_open_legacy integer:=0;
  v_approved_frozen_legacy integer:=0;
  v_approved_v3 integer:=0;
begin
  if not public.dawaa_current_actor_can(array['manage_payroll','manage_attendance','manage_hr']) then
    raise exception 'not_authorized_for_attendance_cutover_readiness' using errcode='42501';
  end if;

  if p_start is null or p_end is null then
    select cycle_start,cycle_end into v_start,v_end
    from public.dawaa_pay_cycle_bounds_v1((now() at time zone 'Africa/Cairo')::date);
  else
    v_start:=p_start;
    v_end:=p_end;
  end if;

  if v_end<v_start then
    raise exception 'invalid_attendance_cutover_range' using errcode='22023';
  end if;

  with compared as (
    select
      a.id,a.status,a.resolution_version,
      public.dawaa_build_attendance_day_resolution_v2(a.staff_id,a.attendance_date) v2,
      public.dawaa_build_attendance_day_resolution_v3(a.staff_id,a.attendance_date) v3
    from public.attendance_daily_summary a
    where a.attendance_date between v_start and v_end
  )
  select
    count(*)::integer,
    count(*) filter(where v2->>'resolution_status' is distinct from v3->>'resolution_status')::integer,
    count(*) filter(where coalesce((v3->>'policy_candidate_changed')::boolean,false))::integer,
    count(*) filter(where nullif(v3->>'resolved_policy_version','') is null)::integer,
    count(*) filter(where coalesce(status,'')<>'approved')::integer,
    count(*) filter(where coalesce(status,'')<>'approved' and coalesce(resolution_version,0)>=3)::integer,
    count(*) filter(where coalesce(status,'')<>'approved' and coalesce(resolution_version,0)<3)::integer,
    count(*) filter(where coalesce(status,'')='approved' and coalesce(resolution_version,0)<3)::integer,
    count(*) filter(where coalesce(status,'')='approved' and coalesce(resolution_version,0)>=3)::integer
  into
    v_total,v_effective,v_candidate,v_unresolved,
    v_open,v_open_v3,v_open_legacy,v_approved_frozen_legacy,v_approved_v3
  from compared;

  return jsonb_build_object(
    'schema','attendance_policy_v3_cutover_readiness_v2',
    'start_date',v_start,
    'end_date',v_end,
    'total_days',v_total,
    'effective_status_changes',v_effective,
    'candidate_changes',v_candidate,
    'unresolved_policy_days',v_unresolved,
    'open_days',v_open,
    'open_v3_days',v_open_v3,
    'open_legacy_days',v_open_legacy,
    'approved_frozen_legacy_days',v_approved_frozen_legacy,
    'approved_v3_days',v_approved_v3,
    'materialization_pct',case when v_open>0 then round(v_open_v3::numeric/v_open*100,2) else 100 end,
    'ready_for_v3_cutover',
      v_effective=0
      and v_candidate=0
      and v_unresolved=0
      and v_open_legacy=0,
    'operational_review_pending',v_open_v3,
    'cutover_rule','all open attendance rows use V3; approved historical truth is immutable',
    'generated_at',now()
  );
end;
$function$;

comment on function public.attendance_policy_v3_cutover_readiness_v1(date,date)
  is 'V2 readiness semantics: engine cutover is based on open rows only; approved historical Attendance Truth remains immutable.';

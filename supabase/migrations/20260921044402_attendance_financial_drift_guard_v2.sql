create or replace function public.attendance_resolution_financial_drift_count_v1(
  p_staff_id uuid,
  p_start date,
  p_end date
)
returns integer
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
  select count(*)::integer
  from public.attendance_daily_summary a
  cross join lateral (
    select public.dawaa_build_attendance_day_resolution_v2(a.staff_id,a.attendance_date) as j
  ) rebuilt
  where a.staff_id=p_staff_id
    and a.attendance_date between p_start and least(p_end,(now() at time zone 'Africa/Cairo')::date-1)
    and a.status='approved'
    and abs(coalesce(a.candidate_hours,0)-coalesce((rebuilt.j->>'candidate_hours')::numeric,0))>0.10;
$$;

revoke all on function public.attendance_resolution_financial_drift_count_v1(uuid,date,date)
  from public,anon,authenticated;
grant execute on function public.attendance_resolution_financial_drift_count_v1(uuid,date,date)
  to service_role,postgres;

create or replace function public.attendance_payroll_engine_v2(
  p_staff_id uuid,
  p_month_cycle text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  j jsonb;
  v_start date;
  v_end date;
  v_all_drift integer:=0;
  v_financial_drift integer:=0;
begin
  j:=public.attendance_payroll_engine_core_v2(p_staff_id,p_month_cycle);
  if coalesce((j->>'ready')::boolean,false) is not true then return j; end if;

  v_start:=(j->>'cycle_start')::date;
  v_end:=(j->>'cycle_end')::date;
  v_all_drift:=public.attendance_resolution_drift_count_v1(p_staff_id,v_start,v_end);
  v_financial_drift:=public.attendance_resolution_financial_drift_count_v1(p_staff_id,v_start,v_end);

  return j || jsonb_build_object(
    'resolution_drift_days',v_all_drift,
    'financial_drift_days',v_financial_drift,
    'classification_only_drift_days',greatest(v_all_drift-v_financial_drift,0),
    'ready_for_final',
      coalesce((j->>'ready_for_final')::boolean,false) and v_financial_drift=0
  );
end;
$$;

revoke all on function public.attendance_payroll_engine_v2(uuid,text) from public,anon;
grant execute on function public.attendance_payroll_engine_v2(uuid,text) to authenticated,service_role;

create or replace function public.dawaa_assert_payroll_profile_ready_v18(p_staff_id uuid,p_month_cycle text)
returns void
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  j jsonb;
  e jsonb;
begin
  j:=public.dawaa_payroll_profile_readiness_v18(p_staff_id,p_month_cycle);
  if coalesce((j->>'ready_for_approval')::boolean,false) is not true then
    raise exception 'payroll_profile_not_ready_for_approval: %',coalesce(j->'missing_fields','[]'::jsonb)::text
      using errcode='22023';
  end if;

  if coalesce(j->>'salary_calculation_mode','')='attendance_hours_v1' then
    e:=public.attendance_payroll_engine_v2(p_staff_id,p_month_cycle);
    if coalesce((e->>'ready_for_final')::boolean,false) is not true then
      raise exception 'attendance_payroll_not_ready_for_final: pending_review=% pending_ot=% financial_drift=% cycle_closed=%',
        coalesce(e->>'pending_review_days','0'),
        coalesce(e->>'pending_overtime_hours','0'),
        coalesce(e->>'financial_drift_days','0'),
        coalesce(e->>'cycle_closed','false')
        using errcode='22023';
    end if;
  end if;
end;
$$;

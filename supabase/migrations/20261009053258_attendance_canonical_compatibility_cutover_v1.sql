-- Compatibility cutover for existing frontend RPC names.
-- Keeps the current UI stable while routing old public entrypoints through the canonical architecture.

do $do$
begin
  if to_regprocedure('public.attendance_case_diagnostic_legacy_v1(uuid,date)') is null then
    alter function public.attendance_case_diagnostic_v1(uuid,date)
      rename to attendance_case_diagnostic_legacy_v1;
  end if;
end;
$do$;

revoke all on function public.attendance_case_diagnostic_legacy_v1(uuid,date) from public,anon,authenticated;
grant execute on function public.attendance_case_diagnostic_legacy_v1(uuid,date) to service_role;

create or replace function public.attendance_case_diagnostic_v2(p_staff_id uuid,p_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_base jsonb;
  v_preview jsonb;
  v_status text;
  v_finalizable boolean:=false;
  v_auto boolean:=false;
  v_triage text;
  v_owner text;
  v_evidence jsonb;
  v_actions jsonb;
begin
  v_base:=public.attendance_case_diagnostic_legacy_v1(p_staff_id,p_date);
  v_preview:=public.dawaa_build_attendance_day_resolution_current_v1(p_staff_id,p_date);
  v_status:=v_base->'evidence'->>'resolution_status';
  v_finalizable:=coalesce((v_preview->>'finalizable')::boolean,false);
  v_auto:=coalesce((v_preview->>'system_resolvable')::boolean,false);

  if not v_finalizable then
    v_triage:='waiting';
    v_owner:='system';
  elsif v_auto then
    v_triage:='auto';
    v_owner:='system';
  elsif v_status in (
    'absence_review','missing_checkin','missing_checkout','early_leave_review',
    'worked_on_off','time_off_with_events'
  ) then
    v_triage:='manager';
    v_owner:='manager';
  else
    v_triage:='system_repair';
    v_owner:=case
      when coalesce(v_base->>'owner','') in ('schedule','sync','timeoff','system') then v_base->>'owner'
      else 'system'
    end;
  end if;

  v_evidence:=coalesce(v_base->'evidence','{}'::jsonb) || jsonb_build_object(
    'canonical_route',v_preview->>'canonical_route',
    'canonical_resolution_status',v_preview->>'resolution_status',
    'canonical_finalizable',v_finalizable,
    'canonical_system_resolvable',v_auto
  );

  v_actions:=case when v_auto then
    jsonb_build_array(jsonb_build_object('id','rematerialize','label','إعادة تحديث حقيقة الحضور تلقائيًا'))
  else coalesce(v_base->'suggested_actions','[]'::jsonb) end;

  return v_base || jsonb_build_object(
    'owner',v_owner,
    'triage',v_triage,
    'auto_fix_available',v_auto,
    'suggested_actions',v_actions,
    'evidence',v_evidence,
    'engine_version','attendance_diagnostic_v2',
    'generated_at',now()
  );
end;
$function$;

revoke all on function public.attendance_case_diagnostic_v2(uuid,date) from public;
grant execute on function public.attendance_case_diagnostic_v2(uuid,date)
to anon,authenticated,service_role;

create or replace function public.attendance_case_diagnostic_v1(p_staff_id uuid,p_date date)
returns jsonb
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
  select public.attendance_case_diagnostic_v2(p_staff_id,p_date)
$function$;

revoke all on function public.attendance_case_diagnostic_v1(uuid,date) from public;
grant execute on function public.attendance_case_diagnostic_v1(uuid,date)
to anon,authenticated,service_role;

create or replace function public.get_attendance_exception_inbox_v2(
  p_start date,
  p_end date,
  p_branch text default null,
  p_lane text default 'manager',
  p_limit integer default 300
)
returns table(
  resolution_id uuid,
  staff_id uuid,
  staff_name text,
  branch text,
  attendance_date date,
  resolution_status text,
  queue_lane text,
  action_required boolean,
  employee_fault boolean,
  issue_group text,
  issue_label text,
  raw_events integer,
  first_in timestamptz,
  last_out timestamptz,
  late_minutes integer,
  early_leave_minutes integer,
  candidate_hours numeric,
  payroll_eligible_hours numeric,
  status text,
  resolution_origin text,
  policy_version text,
  schedule_id uuid
)
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
  select *
  from public.get_attendance_exception_inbox_v3(p_start,p_end,p_branch,p_lane,p_limit)
$function$;

revoke all on function public.get_attendance_exception_inbox_v2(date,date,text,text,integer) from public;
grant execute on function public.get_attendance_exception_inbox_v2(date,date,text,text,integer)
to anon,authenticated,service_role;

create or replace function public.attendance_diagnostic_summary_v1(
  p_start date,
  p_end date,
  p_branch text default null
)
returns jsonb
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
  select public.attendance_diagnostic_summary_v2(p_start,p_end,p_branch)
$function$;

revoke all on function public.attendance_diagnostic_summary_v1(date,date,text) from public;
grant execute on function public.attendance_diagnostic_summary_v1(date,date,text)
to anon,authenticated,service_role;

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
  select public.dawaa_materialize_attendance_range_route_aware_v1(p_start,p_end,p_branch)
$function$;

revoke all on function public.materialize_attendance_range_v2(date,date,text) from public;
grant execute on function public.materialize_attendance_range_v2(date,date,text)
to anon,authenticated,service_role;

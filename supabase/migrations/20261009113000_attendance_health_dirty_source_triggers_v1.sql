-- Make Attendance System Health verify all three dirty-queue ingestion sources.
-- If attendance logs, schedules, or time-off stop marking affected days dirty,
-- technical health must turn red immediately.

do $do$
begin
  if to_regprocedure('public.get_attendance_system_health_core_v1(text)') is null then
    alter function public.get_attendance_system_health_v1(text)
      rename to get_attendance_system_health_core_v1;
  end if;
end;
$do$;

revoke all on function public.get_attendance_system_health_core_v1(text) from public,anon,authenticated;
grant execute on function public.get_attendance_system_health_core_v1(text) to service_role;

create or replace function public.get_attendance_system_health_v1(p_month_cycle text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_base jsonb;
  v_log_trigger boolean:=false;
  v_schedule_trigger boolean:=false;
  v_timeoff_trigger boolean:=false;
  v_trigger_count integer:=0;
  v_sources_ok boolean:=false;
  v_technical text;
  v_operational text;
  v_overall text;
begin
  v_base:=public.get_attendance_system_health_core_v1(p_month_cycle);

  select exists(
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='staff_attendance_logs'
      and t.tgname='trg_dawaa_mark_attendance_dirty_v1' and not t.tgisinternal
  ) into v_log_trigger;

  select exists(
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='shift_schedules'
      and t.tgname='trg_dawaa_mark_attendance_dirty_schedule_v1' and not t.tgisinternal
  ) into v_schedule_trigger;

  select exists(
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname='staff_time_off_requests'
      and t.tgname='trg_dawaa_mark_attendance_dirty_timeoff_v1' and not t.tgisinternal
  ) into v_timeoff_trigger;

  v_trigger_count:=
    (case when v_log_trigger then 1 else 0 end)+
    (case when v_schedule_trigger then 1 else 0 end)+
    (case when v_timeoff_trigger then 1 else 0 end);
  v_sources_ok:=v_trigger_count=3;

  v_technical:=case
    when not v_sources_ok then 'red'
    else coalesce(v_base->>'technical_status','red')
  end;
  v_operational:=coalesce(v_base->>'operational_status','yellow');
  v_overall:=case
    when v_technical='red' then 'red'
    when v_operational='yellow' then 'yellow'
    else 'green'
  end;

  return v_base
    || jsonb_build_object(
      'technical_status',v_technical,
      'operational_status',v_operational,
      'overall_status',v_overall,
      'invariants',coalesce(v_base->'invariants','{}'::jsonb) || jsonb_build_object(
        'dirty_source_triggers_present',v_trigger_count,
        'dirty_source_triggers_expected',3,
        'dirty_source_triggers_ok',v_sources_ok
      ),
      'ingestion_sources',jsonb_build_object(
        'attendance_logs_dirty_trigger',v_log_trigger,
        'schedule_dirty_trigger',v_schedule_trigger,
        'timeoff_dirty_trigger',v_timeoff_trigger
      ),
      'generated_at',now()
    );
end;
$function$;

revoke all on function public.get_attendance_system_health_v1(text) from public;
grant execute on function public.get_attendance_system_health_v1(text)
to anon,authenticated,service_role;

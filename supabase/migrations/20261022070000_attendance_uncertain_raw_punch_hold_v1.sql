-- Conservative fail-closed guard for untrusted biometric interpretations.
-- Existing approved summaries remain immutable; no financial writes.
create or replace function public.attendance_uncertain_raw_punch_for_day_v1(p_staff_id uuid,p_date date)
returns boolean language sql stable security definer set search_path to 'public','pg_catalog' as $guard$
  select exists(
    select 1
    from public.biometric_attendance_logs b
    left join public.biometric_semantic_decisions d on d.biometric_log_id=b.id
    where (b.staff_id=p_staff_id or d.staff_id=p_staff_id)
      and public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)
        >= ((p_date-1)::timestamp at time zone 'Africa/Cairo')
      and public.dawaa_fingerprint_effective_time_v1(b.provider,b.raw_payload,b.punch_time)
        < ((p_date+2)::timestamp at time zone 'Africa/Cairo')
      and (
        d.biometric_log_id is null
        or coalesce(d.decision,'review')<>'accepted'
        or coalesce(d.confidence,0)<0.75
        or coalesce(d.reason,'')='no_matching_schedule_fallback_to_raw'
      )
  );
$guard$;
revoke all on function public.attendance_uncertain_raw_punch_for_day_v1(uuid,date) from public;
revoke all on function public.attendance_uncertain_raw_punch_for_day_v1(uuid,date) from anon,authenticated;
grant execute on function public.attendance_uncertain_raw_punch_for_day_v1(uuid,date) to service_role;

-- Keep both canonical materializers aligned. The original engine still decides
-- finalizability, but cannot auto-approve with ambiguous raw evidence nearby.
do $patch$
declare
  v_name text;
  v_def text;
  v_needle text := 'v_system:=coalesce((v_preview->>''system_resolvable'')::boolean,false);';
  v_replacement text := 'v_system:=coalesce((v_preview->>''system_resolvable'')::boolean,false) and not public.attendance_uncertain_raw_punch_for_day_v1(p_staff_id,p_attendance_date);';
begin
  foreach v_name in array array['dawaa_materialize_attendance_day_internal_v2','dawaa_materialize_attendance_day_internal_v3']
  loop
    select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname=v_name
      and pg_get_function_identity_arguments(p.oid)='p_staff_id uuid, p_attendance_date date';
    if v_def is null or position(v_needle in v_def)=0 then
      raise exception 'attendance_guard_patch_precondition_failed: %',v_name;
    end if;
    execute replace(v_def,v_needle,v_replacement);
  end loop;
end;
$patch$;
-- Keep the manager/system review filters consistent with the new ambiguity hold.
-- Cases held for uncertain raw evidence must not be labeled system-only.
do $queue$
declare
  v_def text;
  v_needle text := 'and b.raw_events>=2';
  v_replacement text := 'and b.raw_events>=2 and not public.attendance_uncertain_raw_punch_for_day_v1((b.row_data).staff_id,(b.row_data).attendance_date)';
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_attendance_resolution_queue_v3';
  if v_def is null or position(v_needle in v_def)=0 then
    raise exception 'attendance_queue_guard_precondition_failed';
  end if;
  execute replace(v_def,v_needle,v_replacement);
end;
$queue$;
notify pgrst,'reload schema';

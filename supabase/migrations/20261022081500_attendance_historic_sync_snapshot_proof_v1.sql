-- Historical approval audit must use the sync watermark captured with the approval,
-- not a newer watermark which might silently rewrite the evidentiary timeline.
create or replace function public.attendance_historic_sync_snapshot_proven_v1(
 p_staff_id uuid,p_date date)
returns boolean language sql stable security definer set search_path to 'public','pg_catalog' as $fn$
 select coalesce(
  a.sync_complete_through >=
   coalesce(a.scheduled_end_at+interval '6 hours',
     (((a.attendance_date+2)::timestamp) at time zone 'Africa/Cairo')),
  false)
 from public.attendance_daily_summary a
 where a.staff_id=p_staff_id and a.attendance_date=p_date
 limit 1;
$fn$;
revoke all on function public.attendance_historic_sync_snapshot_proven_v1(uuid,date) from public,anon,authenticated;
grant execute on function public.attendance_historic_sync_snapshot_proven_v1(uuid,date) to service_role;

do $patch$
declare v_def text;v_old text :=
 'coalesce(public.attendance_sync_proven_for_day_v1(a.staff_id,a.attendance_date),false)';
v_new text :=
 'coalesce(public.attendance_historic_sync_snapshot_proven_v1(a.staff_id,a.attendance_date),false)';
begin
 select pg_get_functiondef(p.oid) into v_def
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='attendance_legacy_approval_evidence_audit_v1';
 if v_def is null or position(v_old in v_def)=0 then
   raise exception 'historic_audit_sync_snapshot_patch_precondition_failed';
 end if;
 execute replace(v_def,v_old,v_new);
end;$patch$;
notify pgrst,'reload schema';

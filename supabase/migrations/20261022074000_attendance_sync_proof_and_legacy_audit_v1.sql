-- Fail closed when branch biometric sync cannot prove a complete workday.
-- Never mutate existing approvals or payroll.
create or replace function public.attendance_sync_proven_for_day_v1(p_staff_id uuid,p_date date)
returns boolean language sql stable security definer set search_path to 'public','pg_catalog' as $guard$
  select coalesce(
    public.attendance_branch_sync_complete_through_v1(s.branch) >=
      coalesce(
        (select q.scheduled_end_at + interval '6 hours'
         from public.attendance_daily_summary q
         where q.staff_id=p_staff_id and q.attendance_date=p_date limit 1),
        (((p_date+2)::timestamp) at time zone 'Africa/Cairo')
      ),
    false
  )
  from public.staff s where s.id=p_staff_id;
$guard$;
revoke all on function public.attendance_sync_proven_for_day_v1(uuid,date) from public,anon,authenticated;
grant execute on function public.attendance_sync_proven_for_day_v1(uuid,date) to service_role;

-- Both engines must have complete sync evidence to auto-approve a new day.
do $patch$
declare v_name text;v_def text;v_old text :=
  'v_system:=coalesce((v_preview->>''system_resolvable'')::boolean,false) and not public.attendance_uncertain_raw_punch_for_day_v1(p_staff_id,p_attendance_date);';
v_new text :=
  'v_system:=coalesce((v_preview->>''system_resolvable'')::boolean,false) and not public.attendance_uncertain_raw_punch_for_day_v1(p_staff_id,p_attendance_date) and coalesce(public.attendance_sync_proven_for_day_v1(p_staff_id,p_attendance_date),false);';
begin
 foreach v_name in array array['dawaa_materialize_attendance_day_internal_v2','dawaa_materialize_attendance_day_internal_v3'] loop
  select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname=v_name
    and pg_get_function_identity_arguments(p.oid)='p_staff_id uuid, p_attendance_date date';
  if v_def is null or position(v_old in v_def)=0 then raise exception 'sync_guard_patch_precondition_failed %',v_name; end if;
  execute replace(v_def,v_old,v_new);
 end loop;
end;$patch$;

-- Read-only retrospective audit; approved rows are NEVER automatically reopened.
create or replace function public.attendance_legacy_approval_evidence_audit_v1(
 p_start date,p_end date,p_limit integer default 250)
returns table(staff_id uuid,staff_name text,branch text,attendance_date date,
 approval_status text, sync_proven boolean, uncertain_raw_evidence boolean,
 scheduled_end_at timestamptz)
language plpgsql stable security definer set search_path to 'public','pg_catalog' as $audit$
begin
 if p_start is null or p_end is null or p_end<p_start or p_end-p_start>62 then
  raise exception 'invalid_audit_range' using errcode='22023';
 end if;
 if public.dawaa_current_staff_account_id_strict() is null then
  raise exception 'audit_requires_authenticated_staff' using errcode='42501';
 end if;
 return query
 select a.staff_id,s.name,s.branch,a.attendance_date,a.status,
   coalesce(public.attendance_sync_proven_for_day_v1(a.staff_id,a.attendance_date),false),
   public.attendance_uncertain_raw_punch_for_day_v1(a.staff_id,a.attendance_date),a.scheduled_end_at
 from public.attendance_daily_summary a join public.staff s on s.id=a.staff_id
 where a.attendance_date between p_start and p_end and a.status='approved'
   and public.dawaa_can_read_staff_attendance_log(a.staff_id,a.branch)
   and (not coalesce(public.attendance_sync_proven_for_day_v1(a.staff_id,a.attendance_date),false)
     or public.attendance_uncertain_raw_punch_for_day_v1(a.staff_id,a.attendance_date))
 order by a.attendance_date desc,s.name
 limit greatest(1,least(coalesce(p_limit,250),500));
end;$audit$;
revoke all on function public.attendance_legacy_approval_evidence_audit_v1(date,date,integer) from public,anon;
grant execute on function public.attendance_legacy_approval_evidence_audit_v1(date,date,integer) to authenticated,service_role;
notify pgrst,'reload schema';

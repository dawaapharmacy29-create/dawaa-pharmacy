-- Attendance-only server command boundary. Custom-session browsers never receive EXECUTE.
-- Generated locally; ordered after the original dated correction migration.
-- Reuses canonical identity, scope, time-off lifecycle and attendance builders.

create table public.attendance_inline_review_holds_v1 (
 staff_id uuid not null references public.staff(id), attendance_date date not null,
 actor_id uuid not null references public.staff_accounts(id), reason text not null,
 created_at timestamptz not null default now(), primary key(staff_id,attendance_date)
);
alter table public.attendance_inline_review_holds_v1 enable row level security;
revoke all on public.attendance_inline_review_holds_v1 from public,anon,authenticated,service_role;

create table public.attendance_inline_command_receipts_v1 (
 staff_id uuid not null references public.staff(id), attendance_date date not null,
 action text not null, payload_hash text not null, actor_id uuid not null references public.staff_accounts(id),
 result jsonb not null, created_at timestamptz not null default now(),
 primary key(staff_id,attendance_date,action,payload_hash)
);
alter table public.attendance_inline_command_receipts_v1 enable row level security;
revoke all on public.attendance_inline_command_receipts_v1 from public,anon,authenticated,service_role;

-- Reject historical duplicate data rather than deleting/merging any operational records.
-- PostgreSQL's unique-index conflict check serializes independent tabs and legacy creators too.
-- NULLS NOT DISTINCT requires PostgreSQL 15+ (the existing platform contract).
create unique index attendance_permission_exact_active_v1
 on public.staff_time_off_requests(staff_id,start_date,end_date,start_time,end_time) nulls not distinct
 where request_kind='permission' and status in ('pending','approved');

-- Scope is an indexed staff/day hold, never a global change to automatic attendance.
-- Protect permission review from a background materializer as well as the HTTP command.
create function public.dawaa_guard_inline_attendance_approval_v1()
returns trigger language plpgsql security definer set search_path = public,pg_catalog as $$
begin
 if new.status='approved' and exists(select 1 from public.attendance_inline_review_holds_v1 h
     where h.staff_id=new.staff_id and h.attendance_date=new.attendance_date) then
   if new.resolution_origin is distinct from 'manager'
      or public.dawaa_session_account_id_v1() is null
      or new.approved_by is distinct from public.dawaa_current_staff_account_id_strict()::text
      or not coalesce(public.dawaa_current_actor_can(array['manage_payroll']),false) then
     raise exception 'attendance_inline_requires_explicit_manager_approval' using errcode='55000';
   end if;
 end if;
 return new;
end;
$$;
revoke all on function public.dawaa_guard_inline_attendance_approval_v1() from public,anon,authenticated,service_role;
create trigger attendance_inline_approval_guard_v1 before insert or update of status on public.attendance_daily_summary
for each row execute function public.dawaa_guard_inline_attendance_approval_v1();

-- Persist a review projection, without settling attendance or synchronizing money.
-- The canonical builder owns clocks, permissions, identity, night shifts and hours.
create function public.dawaa_refresh_inline_attendance_review_v1(p_staff_id uuid,p_date date)
returns public.attendance_daily_summary language plpgsql security definer set search_path = public,pg_catalog as $$
declare v_preview jsonb; v_data public.attendance_daily_summary; v_saved public.attendance_daily_summary;
begin
 select * into strict v_saved from public.attendance_daily_summary
 where staff_id=p_staff_id and attendance_date=p_date for update;
 if v_saved.status='approved' then raise exception 'approved_attendance_cannot_be_rewritten' using errcode='55000'; end if;
 v_preview:=public.dawaa_build_attendance_day_resolution_current_v1(p_staff_id,p_date);
 if v_preview->>'canonical_route' is distinct from 'standard_v2'
    or v_preview->>'staff_id' is distinct from p_staff_id::text
    or v_preview->>'attendance_date' is distinct from p_date::text
    or not (v_preview ? 'candidate_hours') then
   raise exception 'attendance_inline_projection_unavailable' using errcode='55000';
 end if;
 v_data:=jsonb_populate_record(null::public.attendance_daily_summary,v_preview);
 update public.attendance_daily_summary set
 branch=v_data.branch,first_in=v_data.first_in,last_out=v_data.last_out,
 total_hours=v_data.candidate_hours,candidate_hours=v_data.candidate_hours,
 late_minutes=v_data.late_minutes,early_leave_minutes=v_data.early_leave_minutes,
 schedule_id=v_data.schedule_id,scheduled_start_at=v_data.scheduled_start_at,scheduled_end_at=v_data.scheduled_end_at,
 resolution_status=v_data.resolution_status,resolution_snapshot=v_preview,resolution_version=2,
 policy_version=v_data.policy_version,time_off_request_id=v_data.time_off_request_id,sync_complete_through=v_data.sync_complete_through,
 status='pending_review',source='attendance_inline_review_v1',resolution_origin='review_queue',review_required=true,
 payroll_eligible_hours=null,approved_at=null,approved_by=null,approved_by_name=null,approval_note=null,resolved_at=null,updated_at=now()
 where id=v_saved.id returning * into v_saved;
 return v_saved;
end;
$$;
revoke all on function public.dawaa_refresh_inline_attendance_review_v1(uuid,date) from public,anon,authenticated,service_role;

create or replace function public.resolve_dated_shift_from_attendance_v1(
 p_staff_id uuid,p_date date,p_start time,p_end time,p_note text
) returns jsonb language plpgsql security definer set search_path to 'public','pg_catalog' as $fn$
declare
 v_staff public.staff%rowtype;
 v_schedule record;
 v_override_count integer;
 v_override_id uuid;
 v_hours numeric;
 v_record_id uuid;
 v_result jsonb;
begin
 if p_staff_id is null or p_date is null or p_start is null or p_end is null
    or p_start=p_end or length(trim(coalesce(p_note,'')))<5 then
   raise exception 'shift_correction_requires_date_times_and_reason' using errcode='22023';
 end if;
 if public.dawaa_session_account_id_v1() is null
    or public.dawaa_current_staff_account_id_strict() is distinct from public.dawaa_session_account_id_v1()
    or not coalesce(public.dawaa_time_off_can_decide_staff_v1(p_staff_id),false) then
   raise exception 'not_authorized_for_attendance_shift_correction' using errcode='42501';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(p_staff_id::text||':'||p_date::text,0));
 select * into v_staff from public.staff where id=p_staff_id;
 if not found then raise exception 'staff_not_found' using errcode='22023'; end if;
 if exists(select 1 from public.attendance_daily_summary a
           where a.staff_id=p_staff_id and a.attendance_date=p_date and a.status='approved') then
   raise exception 'approved_attendance_cannot_be_rewritten' using errcode='55000';
 end if;
 if exists(select 1 from public.attendance_dated_shift_corrections_v1 a
           where a.staff_id=p_staff_id and a.attendance_date=p_date) then
   raise exception 'dated_shift_correction_already_exists_review_first' using errcode='55000';
 end if;
 if exists(select 1 from public.staff_time_off_requests r where r.staff_id=p_staff_id and r.status='approved'
    and r.request_kind in ('annual_leave','sick_leave','exceptional_leave','approved_absence')
    and p_date between r.start_date and r.end_date) then
   raise exception 'shift_correction_conflicts_with_approved_leave' using errcode='55000';
 end if;
 select * into v_schedule from public.attendance_schedule_for_date_v1(p_staff_id,p_date) limit 1;
 if v_schedule.schedule_id is null then
   raise exception 'dated_shift_correction_missing_schedule' using errcode='55000';
 end if;
 select count(*) into v_override_count from public.shift_schedules
 where staff_id=p_staff_id and coalesce(shift_date,date)=p_date;
 if v_override_count<>0 then
   raise exception 'dated_shift_correction_existing_override_needs_review' using errcode='55000';
 end if;
 v_hours:=round((extract(epoch from ((timestamp '2000-01-01'+p_end)
                  -(timestamp '2000-01-01'+p_start)
                  +case when p_end<=p_start then interval '1 day' else interval '0 day' end))/3600)::numeric,2);
 if v_hours>18 then raise exception 'shift_correction_exceeds_18_hours' using errcode='22023'; end if;
 insert into public.shift_schedules (
 staff_id,staff_name,employee_name,role,branch,day_name,shift_start,shift_end,
 start_time,end_time,hours,is_off,is_day_off,is_different,has_custom_time,
 shift_date,date,status,source,notes,effective_from,effective_to
 ) values (
 p_staff_id,v_staff.name,v_staff.name,v_staff.role,v_staff.branch,
 case extract(dow from p_date)::int when 0 then 'الأحد' when 1 then 'الاثنين'
 when 2 then 'الثلاثاء' when 3 then 'الأربعاء' when 4 then 'الخميس'
 when 5 then 'الجمعة' else 'السبت' end,
 to_char(p_start,'HH24:MI'),to_char(p_end,'HH24:MI'),
 p_start,p_end,v_hours,false,false,true,true,
 p_date,p_date,'scheduled','attendance_dated_shift_correction_v1',trim(p_note),p_date,p_date
 ) returning id into v_override_id;
 insert into public.attendance_dated_shift_corrections_v1
 (staff_id,attendance_date,previous_schedule,shift_start,shift_end,override_id,actor_id,note)
 values (p_staff_id,p_date,to_jsonb(v_schedule),p_start,p_end,v_override_id,
 public.employee_operating_actor_id(),trim(p_note)) returning id into v_record_id;
 -- Recompute through the canonical guard. Do not approve unproven days here.
 v_result:=to_jsonb(public.dawaa_materialize_attendance_day_internal_v2(p_staff_id,p_date));
 if exists (select 1 from public.attendance_daily_summary
   where staff_id=p_staff_id and attendance_date=p_date and status='approved') then
   raise exception 'date_shift_correction_requires_explicit_manager_attendance_approval' using errcode='55000';
 end if;
 return jsonb_build_object('success',true,'correction_id',v_record_id,
   'override_id',v_override_id,'date',p_date,'materialization',coalesce(v_result,'{}'::jsonb),
   'requires_review',true);
end;
$fn$;
revoke execute on function public.resolve_dated_shift_from_attendance_v1(uuid,date,time,time,text) from public,anon,authenticated;
grant execute on function public.resolve_dated_shift_from_attendance_v1(uuid,date,time,time,text) to service_role;

create function public.attendance_inline_command_v1(p_action text,p_staff_id uuid,p_date date,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public,pg_catalog as $$
declare
 v_actor uuid:=public.dawaa_session_account_id_v1(); v_branch text; v_hash text;
 v_receipt jsonb; v_result jsonb; v_day public.attendance_daily_summary;
 v_request public.staff_time_off_requests; v_preflight jsonb; v_start time; v_end time;
 v_preview jsonb; v_note text:=btrim(coalesce(p_payload->>'note','')); v_hours numeric;
begin
 if v_actor is null or public.dawaa_current_staff_account_id_strict() is distinct from v_actor then
   raise exception 'invalid_or_expired_staff_session' using errcode='42501';
 end if;
 if p_staff_id is null or p_date is null or p_action is null or p_action not in ('shift','permission','approve','punch')
    or jsonb_typeof(p_payload) is distinct from 'object' or length(p_payload::text)>8192 or length(v_note)<1 then
   raise exception 'attendance_inline_invalid_command' using errcode='22023';
 end if;
 select branch into v_branch from public.staff where id=p_staff_id;
 if not found or not coalesce(public.dawaa_can_read_staff_attendance_log(p_staff_id,v_branch),false) then
   raise exception 'not_authorized_for_attendance_inline_staff' using errcode='42501';
 end if;
 if p_action='approve' then
   if not coalesce(public.dawaa_current_actor_can(array['manage_payroll']),false) then
     raise exception 'not_authorized_for_attendance_approval' using errcode='42501';
   end if;
 elsif not coalesce(public.dawaa_time_off_can_decide_staff_v1(p_staff_id),false) then
   raise exception 'not_authorized_for_attendance_inline_change' using errcode='42501';
 end if;
 -- One lock order for ALL inline actions and all days of an employee (includes cycle quota checks).
 perform pg_advisory_xact_lock(hashtextextended('attendance-inline:'||p_staff_id::text,0));
 select * into strict v_day from public.attendance_daily_summary
 where staff_id=p_staff_id and attendance_date=p_date for update;
 v_hash:=md5(p_payload::text);
 select result into v_receipt from public.attendance_inline_command_receipts_v1
 where staff_id=p_staff_id and attendance_date=p_date and action=p_action and payload_hash=v_hash;
 if found then return v_receipt; end if;
 if v_day.status='approved' then
   if p_action='approve' then return to_jsonb(v_day); end if;
   raise exception 'approved_attendance_cannot_be_rewritten' using errcode='55000';
 end if;
 v_preview:=public.dawaa_build_attendance_day_resolution_current_v1(p_staff_id,p_date);
 if v_preview->>'canonical_route' is distinct from 'standard_v2' then
   raise exception 'attendance_inline_route_not_supported' using errcode='55000';
 end if;
 if p_action='shift' then
   -- The original routine must RAISE and roll back the entire call if materialization approves.
   if coalesce(p_payload->>'start','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      or coalesce(p_payload->>'end','') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
     raise exception 'attendance_inline_invalid_shift_times' using errcode='22023';
   end if;
   v_result:=public.resolve_dated_shift_from_attendance_v1(p_staff_id,p_date,
     (p_payload->>'start')::time,(p_payload->>'end')::time,v_note);
 elsif p_action='permission' then
   v_start:=(p_payload->>'start')::time; v_end:=(p_payload->>'end')::time;
   if v_start is null or v_end is null or v_end<=v_start then
     raise exception 'permission_same_day_valid_range_required' using errcode='22023';
   end if;
   -- Lock any existing lifecycle row too; do not approve a different interval silently.
   select * into v_request from public.staff_time_off_requests
   where staff_id=p_staff_id and request_kind='permission' and status in ('pending','approved')
     and start_date<=p_date and end_date>=p_date order by created_at,id limit 1 for update;
   if found and (v_request.start_date<>p_date or v_request.end_date<>p_date
      or v_request.start_time is distinct from v_start or v_request.end_time is distinct from v_end) then
     raise exception 'attendance_inline_existing_permission_range_conflict' using errcode='55000';
   end if;
   if v_request.id is null then
     v_request:=public.create_staff_time_off_request_v1(p_staff_id,'permission',null,p_date,p_date,
       v_start,v_end,(extract(epoch from(v_end-v_start))/60)::integer,v_note);
   end if;
   if v_request.status='pending' then
     v_preflight:=public.time_off_request_preflight_v3(v_request.id);
     if not coalesce((v_preflight->>'allowed')::boolean,false) then
       -- Keep the single pending official request visible; never finalize the day.
       return jsonb_build_object('success',true,'approved',false,'request',to_jsonb(v_request),'preflight',v_preflight);
     end if;
     begin
       v_request:=public.decide_staff_time_off_request_v3(v_request.id,'approved',v_note);
     exception when insufficient_privilege then
       if sqlerrm<>'permission_policy_exception_requires_top_management' then raise; end if;
       -- Only the documented policy refusal is recoverable: keep the official pending request.
       return jsonb_build_object('success',true,'approved',false,'request',to_jsonb(v_request),
         'preflight',v_preflight || jsonb_build_object('allowed',false,'blockers',jsonb_build_array(
           jsonb_build_object('code','permission_policy_exception_requires_top_management','label','سياسة الإذن تحتاج اعتماد الإدارة العليا'))));
     end;
   end if;
   if v_request.status<>'approved' then raise exception 'attendance_inline_permission_not_approved' using errcode='55000'; end if;
   insert into public.attendance_inline_review_holds_v1(staff_id,attendance_date,actor_id,reason)
   values(p_staff_id,p_date,v_actor,'permission') on conflict(staff_id,attendance_date) do nothing;
   v_day:=public.dawaa_refresh_inline_attendance_review_v1(p_staff_id,p_date);
   if v_day.time_off_request_id is distinct from v_request.id
      or coalesce((v_day.resolution_snapshot->>'permission_attached')::boolean,false) is not true then
     raise exception 'attendance_inline_permission_not_attached' using errcode='55000';
   end if;
   v_result:=jsonb_build_object('success',true,'approved',true,'request',to_jsonb(v_request),'day',to_jsonb(v_day));
 elsif p_action='punch' then
   v_result:=public.resolve_missing_punch_incident_v1(p_staff_id,p_date,p_payload->>'missingType',
      (p_payload->>'recordedAt')::timestamptz,v_note,coalesce((p_payload->>'applyDeduction')::boolean,false));
 else
   if not coalesce((v_preview->>'finalizable')::boolean,false)
      or public.dawaa_attendance_review_triage_v1(v_preview->>'resolution_status',v_preview) not in ('manager','auto') then
     raise exception 'attendance_inline_evidence_not_finalizable' using errcode='55000';
   end if;
   -- The browser cannot opt out of complete evidence on this inline finalization route.
   if (nullif(v_preview->>'first_in','') is null or nullif(v_preview->>'last_out','') is null
      or nullif(v_preview->>'scheduled_start_at','') is null or nullif(v_preview->>'scheduled_end_at','') is null
      or nullif(v_preview->>'candidate_hours','') is null) then
     raise exception 'attendance_inline_complete_evidence_required' using errcode='55000';
   end if;
   -- Explicit legacy manager overrides remain supported; the separate final action sends NULL.
   v_hours:=nullif(p_payload->>'hours','')::numeric;
   v_day:=public.approve_attendance_day_resolution_v2(p_staff_id,p_date,v_hours,v_note);
   if v_day.status is distinct from 'approved' then raise exception 'attendance_inline_approval_not_saved'; end if;
   delete from public.attendance_inline_review_holds_v1 where staff_id=p_staff_id and attendance_date=p_date;
   v_result:=to_jsonb(v_day);
 end if;
 insert into public.attendance_inline_command_receipts_v1(staff_id,attendance_date,action,payload_hash,actor_id,result)
 values(p_staff_id,p_date,p_action,v_hash,v_actor,v_result);
 return v_result;
end;
$$;
revoke all on function public.attendance_inline_command_v1(text,uuid,date,jsonb) from public,anon,authenticated;
grant execute on function public.attendance_inline_command_v1(text,uuid,date,jsonb) to service_role;
-- Preserve the existing legacy RPC grants until every independent caller has been
-- audited and migrated. Removing their EXECUTE permissions here could break
-- existing attendance flows outside the new inline dialog.
-- The new attendance_inline_command_v1 and dated-shift RPC remain service_role-only.
-- The scoped attendance_inline_approval_guard still protects explicitly held days.
notify pgrst,'reload schema';

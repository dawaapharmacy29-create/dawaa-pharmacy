-- Materialization, review queue, approval, audit, and impact classification for attendance v2.

create or replace function public.dawaa_sync_attendance_impact_for_resolution_v2(p_resolution_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_r public.attendance_daily_summary%rowtype;
  v_event text;
  v_key text;
begin
  select * into v_r from public.attendance_daily_summary where id=p_resolution_id and status='approved';
  if not found then return; end if;

  v_event:=case v_r.resolution_status
    when 'on_time' then 'attendance_on_time'
    when 'on_time_with_permission' then 'attendance_on_time_with_permission'
    when 'late' then 'attendance_late'
    when 'very_late' then 'attendance_very_late'
    when 'approved_time_off' then 'attendance_approved_time_off'
    when 'off_day' then 'attendance_off_day'
    when 'absence_review' then 'attendance_absence_confirmed'
    when 'early_leave_review' then 'attendance_early_leave_confirmed'
    when 'worked_on_off' then 'attendance_worked_on_off_confirmed'
    else 'attendance_manual_resolution'
  end;

  v_key:=concat_ws(':','attendance_v2',v_r.staff_id::text,v_r.attendance_date::text,v_event,coalesce(v_r.policy_version,'unconfigured'),v_r.id::text);

  insert into public.attendance_impact_ledger(
    idempotency_key,staff_id,attendance_date,event_type,source_resolution_id,
    source_time_off_request_id,policy_version,impact_status,evidence_snapshot,created_by
  ) values(
    v_key,v_r.staff_id,v_r.attendance_date,v_event,v_r.id,
    v_r.time_off_request_id,v_r.policy_version,'classified',coalesce(v_r.resolution_snapshot,'{}'::jsonb),coalesce(v_r.approved_by,'system')
  )
  on conflict(idempotency_key) do nothing;
end;
$function$;

revoke all on function public.dawaa_sync_attendance_impact_for_resolution_v2(uuid) from public,anon,authenticated;
grant execute on function public.dawaa_sync_attendance_impact_for_resolution_v2(uuid) to service_role;

create or replace function public.dawaa_materialize_attendance_day_internal_v2(p_staff_id uuid,p_attendance_date date)
returns public.attendance_daily_summary
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_preview jsonb;
  v_saved public.attendance_daily_summary%rowtype;
  v_system boolean;
  v_finalizable boolean;
  v_hours numeric;
  v_resolution_status text;
  v_action text;
begin
  select * into v_saved
  from public.attendance_daily_summary
  where staff_id=p_staff_id and attendance_date=p_attendance_date
    and status='approved' and coalesce(resolution_version,0)>=2
  limit 1;
  if found then return v_saved; end if;

  v_preview:=public.dawaa_build_attendance_day_resolution_v2(p_staff_id,p_attendance_date);
  v_system:=coalesce((v_preview->>'system_resolvable')::boolean,false);
  v_finalizable:=coalesce((v_preview->>'finalizable')::boolean,false);
  v_resolution_status:=v_preview->>'resolution_status';

  if not v_finalizable then
    select * into v_saved from public.attendance_daily_summary
    where staff_id=p_staff_id and attendance_date=p_attendance_date limit 1;
    return v_saved;
  end if;

  v_hours:=case when v_resolution_status in ('off_day','approved_time_off') then 0 else coalesce((v_preview->>'candidate_hours')::numeric,0) end;

  insert into public.attendance_daily_summary(
    staff_id,attendance_date,branch,first_in,last_out,total_hours,late_minutes,early_leave_minutes,
    missing_punch,status,source,schedule_id,scheduled_start_at,scheduled_end_at,candidate_hours,
    payroll_eligible_hours,resolution_status,resolution_version,resolution_snapshot,
    approved_at,approved_by,approved_by_name,approval_note,updated_at,
    resolution_origin,review_required,resolved_at,time_off_request_id,policy_version,sync_complete_through
  ) values(
    p_staff_id,p_attendance_date,v_preview->>'branch',
    nullif(v_preview->>'first_in','')::timestamptz,
    nullif(v_preview->>'last_out','')::timestamptz,
    coalesce((v_preview->>'candidate_hours')::numeric,0),
    coalesce((v_preview->>'late_minutes')::integer,0),
    coalesce((v_preview->>'early_leave_minutes')::integer,0),
    not v_system,
    case when v_system then 'approved' else 'pending_review' end,
    'attendance_resolution_v2',
    nullif(v_preview->>'schedule_id','')::uuid,
    nullif(v_preview->>'scheduled_start_at','')::timestamptz,
    nullif(v_preview->>'scheduled_end_at','')::timestamptz,
    coalesce((v_preview->>'candidate_hours')::numeric,0),
    case when v_system then v_hours else null end,
    v_resolution_status,2,v_preview,
    case when v_system then now() else null end,
    case when v_system then 'system:auto-attendance-v2' else null end,
    case when v_system then 'النظام التلقائي للحضور' else null end,
    null,now(),
    case when v_system then 'system' else 'review_queue' end,
    not v_system,now(),
    nullif(v_preview->>'time_off_request_id','')::uuid,
    v_preview->>'policy_version',
    nullif(v_preview->>'sync_complete_through','')::timestamptz
  )
  on conflict(staff_id,attendance_date) where staff_id is not null and attendance_date is not null
  do update set
    branch=excluded.branch,first_in=excluded.first_in,last_out=excluded.last_out,total_hours=excluded.total_hours,
    late_minutes=excluded.late_minutes,early_leave_minutes=excluded.early_leave_minutes,missing_punch=excluded.missing_punch,
    status=excluded.status,source=excluded.source,schedule_id=excluded.schedule_id,scheduled_start_at=excluded.scheduled_start_at,
    scheduled_end_at=excluded.scheduled_end_at,candidate_hours=excluded.candidate_hours,payroll_eligible_hours=excluded.payroll_eligible_hours,
    resolution_status=excluded.resolution_status,resolution_version=excluded.resolution_version,resolution_snapshot=excluded.resolution_snapshot,
    approved_at=excluded.approved_at,approved_by=excluded.approved_by,approved_by_name=excluded.approved_by_name,
    approval_note=excluded.approval_note,updated_at=excluded.updated_at,resolution_origin=excluded.resolution_origin,
    review_required=excluded.review_required,resolved_at=excluded.resolved_at,time_off_request_id=excluded.time_off_request_id,
    policy_version=excluded.policy_version,sync_complete_through=excluded.sync_complete_through
  where public.attendance_daily_summary.status is distinct from 'approved'
  returning * into v_saved;

  if v_saved.id is null then
    select * into v_saved from public.attendance_daily_summary where staff_id=p_staff_id and attendance_date=p_attendance_date limit 1;
  end if;

  if v_saved.id is not null then
    v_action:=case when v_saved.status='approved' then 'system_resolved' else 'review_queued' end;
    insert into public.attendance_resolution_audit(resolution_id,staff_id,attendance_date,action,actor_id,actor_name,note,snapshot)
    select v_saved.id,p_staff_id,p_attendance_date,v_action,'system:auto-attendance-v2','النظام التلقائي للحضور',v_preview->>'reason',v_preview
    where not exists(
      select 1 from public.attendance_resolution_audit a
      where a.resolution_id=v_saved.id and a.action=v_action and a.snapshot=v_preview
    );
    if v_saved.status='approved' then perform public.dawaa_sync_attendance_impact_for_resolution_v2(v_saved.id); end if;
  end if;

  return v_saved;
end;
$function$;

revoke all on function public.dawaa_materialize_attendance_day_internal_v2(uuid,date) from public,anon,authenticated;
grant execute on function public.dawaa_materialize_attendance_day_internal_v2(uuid,date) to service_role;

create or replace function public.dawaa_materialize_attendance_range_internal_v2(p_start date,p_end date,p_branch text default null)
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
begin
  if p_start is null or p_end is null or p_end<p_start or p_end-p_start>45 then
    raise exception 'attendance_materialize_invalid_range' using errcode='22023';
  end if;

  for v_d in select generate_series(p_start,p_end,interval '1 day')::date loop
    for v_staff in
      select s.id from public.staff s
      where coalesce(s.active,false)=true
        and s.branch in ('فرع الشامي','فرع شكري')
        and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or s.branch=p_branch)
    loop
      v_row:=public.dawaa_materialize_attendance_day_internal_v2(v_staff.id,v_d);
      if v_row.id is not null then
        v_processed:=v_processed+1;
        if v_row.status='approved' then v_approved:=v_approved+1;
        elsif v_row.status='pending_review' then v_review:=v_review+1;
        end if;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('processed',v_processed,'approved',v_approved,'pending_review',v_review,'start',p_start,'end',p_end,'branch',p_branch,'resolution_version',2);
end;
$function$;

revoke all on function public.dawaa_materialize_attendance_range_internal_v2(date,date,text) from public,anon,authenticated;
grant execute on function public.dawaa_materialize_attendance_range_internal_v2(date,date,text) to service_role;

create or replace function public.materialize_attendance_range_v2(p_start date,p_end date,p_branch text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare v_actor public.staff_accounts%rowtype;
begin
  select * into v_actor from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true;
  if not found or not public.dawaa_actor_is_top_management_v1() then
    raise exception 'not_authorized_for_attendance_materialization' using errcode='42501';
  end if;
  return public.dawaa_materialize_attendance_range_internal_v2(p_start,p_end,p_branch);
end;
$function$;

revoke all on function public.materialize_attendance_range_v2(date,date,text) from public,anon;
grant execute on function public.materialize_attendance_range_v2(date,date,text) to authenticated,service_role;

create or replace function public.approve_attendance_day_resolution_v2(
  p_staff_id uuid,
  p_attendance_date date,
  p_payroll_eligible_hours numeric default null,
  p_note text default null
)
returns public.attendance_daily_summary
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_username text;
  v_actor_id text:=public.employee_operating_actor_id();
  v_actor_name text;
  v_actor_role text;
  v_preview jsonb;
  v_saved public.attendance_daily_summary%rowtype;
  v_candidate numeric;
  v_hours numeric;
  v_system boolean;
begin
  select sa.username into v_username
  from public.staff_accounts sa
  where trim(coalesce(sa.staff_id,''))=p_staff_id::text or sa.id=p_staff_id
  order by (trim(coalesce(sa.staff_id,''))=p_staff_id::text) desc,coalesce(sa.active,true) desc limit 1;

  if v_username is null then raise exception 'attendance_resolution_staff_identity_missing'; end if;
  if not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_attendance_resolution' using errcode='42501';
  end if;

  select * into v_saved from public.attendance_daily_summary
  where staff_id=p_staff_id and attendance_date=p_attendance_date
    and status='approved' and coalesce(resolution_version,0)>=2
  for update;
  if found then return v_saved; end if;

  v_preview:=public.dawaa_build_attendance_day_resolution_v2(p_staff_id,p_attendance_date);
  if not coalesce((v_preview->>'finalizable')::boolean,false) then
    raise exception 'attendance_resolution_not_finalizable_yet' using errcode='22023';
  end if;

  v_candidate:=coalesce((v_preview->>'candidate_hours')::numeric,0);
  v_system:=coalesce((v_preview->>'system_resolvable')::boolean,false);
  v_hours:=coalesce(p_payroll_eligible_hours,case when v_preview->>'resolution_status' in ('off_day','approved_time_off') then 0 else v_candidate end);

  if v_hours<0 or v_hours>18 then raise exception 'attendance_resolution_hours_out_of_range' using errcode='22023'; end if;
  if not v_system and nullif(trim(coalesce(p_note,'')),'') is null then
    raise exception 'attendance_resolution_review_requires_note' using errcode='22023';
  end if;
  if abs(v_hours-v_candidate)>0.01
     and v_preview->>'resolution_status' not in ('off_day','approved_time_off')
     and nullif(trim(coalesce(p_note,'')),'') is null then
    raise exception 'attendance_resolution_changed_hours_require_note' using errcode='22023';
  end if;

  select coalesce(sa.name,sa.staff_name,sa.username),coalesce(sa.role,'')
    into v_actor_name,v_actor_role
  from public.staff_accounts sa where sa.id::text=v_actor_id limit 1;

  insert into public.attendance_daily_summary(
    staff_id,attendance_date,branch,first_in,last_out,total_hours,late_minutes,early_leave_minutes,
    missing_punch,status,source,schedule_id,scheduled_start_at,scheduled_end_at,candidate_hours,
    payroll_eligible_hours,resolution_status,resolution_version,resolution_snapshot,
    approved_at,approved_by,approved_by_name,approval_note,updated_at,
    resolution_origin,review_required,resolved_at,time_off_request_id,policy_version,sync_complete_through
  ) values(
    p_staff_id,p_attendance_date,v_preview->>'branch',
    nullif(v_preview->>'first_in','')::timestamptz,
    nullif(v_preview->>'last_out','')::timestamptz,
    v_candidate,
    coalesce((v_preview->>'late_minutes')::integer,0),
    coalesce((v_preview->>'early_leave_minutes')::integer,0),
    not v_system,'approved','attendance_resolution_v2',
    nullif(v_preview->>'schedule_id','')::uuid,
    nullif(v_preview->>'scheduled_start_at','')::timestamptz,
    nullif(v_preview->>'scheduled_end_at','')::timestamptz,
    v_candidate,v_hours,
    v_preview->>'resolution_status',2,
    v_preview||jsonb_build_object('manager_approved_payroll_eligible_hours',v_hours,'manager_approval_note',nullif(trim(coalesce(p_note,'')),'')),
    now(),v_actor_id,v_actor_name,nullif(trim(coalesce(p_note,'')),''),now(),
    'manager',false,now(),
    nullif(v_preview->>'time_off_request_id','')::uuid,
    v_preview->>'policy_version',
    nullif(v_preview->>'sync_complete_through','')::timestamptz
  )
  on conflict(staff_id,attendance_date) where staff_id is not null and attendance_date is not null
  do update set
    branch=excluded.branch,first_in=excluded.first_in,last_out=excluded.last_out,total_hours=excluded.total_hours,
    late_minutes=excluded.late_minutes,early_leave_minutes=excluded.early_leave_minutes,missing_punch=excluded.missing_punch,
    status='approved',source=excluded.source,schedule_id=excluded.schedule_id,scheduled_start_at=excluded.scheduled_start_at,
    scheduled_end_at=excluded.scheduled_end_at,candidate_hours=excluded.candidate_hours,payroll_eligible_hours=excluded.payroll_eligible_hours,
    resolution_status=excluded.resolution_status,resolution_version=2,resolution_snapshot=excluded.resolution_snapshot,
    approved_at=excluded.approved_at,approved_by=excluded.approved_by,approved_by_name=excluded.approved_by_name,
    approval_note=excluded.approval_note,updated_at=excluded.updated_at,resolution_origin='manager',review_required=false,
    resolved_at=excluded.resolved_at,time_off_request_id=excluded.time_off_request_id,policy_version=excluded.policy_version,
    sync_complete_through=excluded.sync_complete_through
  where public.attendance_daily_summary.status is distinct from 'approved'
  returning * into v_saved;

  if v_saved.id is null then
    select * into v_saved from public.attendance_daily_summary where staff_id=p_staff_id and attendance_date=p_attendance_date limit 1;
  end if;

  insert into public.attendance_resolution_audit(
    resolution_id,staff_id,attendance_date,action,actor_id,actor_name,actor_role,note,snapshot
  ) values(
    v_saved.id,p_staff_id,p_attendance_date,'manager_approved',v_actor_id,v_actor_name,v_actor_role,
    nullif(trim(coalesce(p_note,'')),''),v_saved.resolution_snapshot
  );

  perform public.dawaa_sync_attendance_impact_for_resolution_v2(v_saved.id);
  return v_saved;
end;
$function$;

revoke all on function public.approve_attendance_day_resolution_v2(uuid,date,numeric,text) from public,anon;
grant execute on function public.approve_attendance_day_resolution_v2(uuid,date,numeric,text) to authenticated,service_role;

create or replace function public.get_attendance_resolution_queue_v2(
  p_start date,
  p_end date,
  p_branch text default null,
  p_status text default null,
  p_limit integer default 300
)
returns setof public.attendance_daily_summary
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare v_actor public.staff_accounts%rowtype;
begin
  select * into v_actor from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true;
  if not found then raise exception 'active staff actor required' using errcode='42501'; end if;

  return query
  select a.* from public.attendance_daily_summary a
  where a.attendance_date between p_start and p_end
    and coalesce(a.resolution_version,0)>=2
    and (p_branch is null or trim(p_branch)='' or p_branch='الكل' or a.branch=p_branch)
    and (p_status is null or trim(p_status)='' or a.status=p_status)
    and public.dawaa_can_read_staff_attendance_log(a.staff_id,a.branch)
  order by case when a.status='pending_review' then 0 else 1 end,a.attendance_date desc,a.branch,a.staff_id
  limit greatest(1,least(coalesce(p_limit,300),1000));
end;
$function$;

revoke all on function public.get_attendance_resolution_queue_v2(date,date,text,text,integer) from public,anon;
grant execute on function public.get_attendance_resolution_queue_v2(date,date,text,text,integer) to authenticated,service_role;

create or replace function public.get_attendance_impact_ledger_v2(
  p_staff_id uuid default null,
  p_start date default null,
  p_end date default null,
  p_limit integer default 300
)
returns setof public.attendance_impact_ledger
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare v_actor public.staff_accounts%rowtype;
begin
  select * into v_actor from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true;
  if not found then raise exception 'active staff actor required' using errcode='42501'; end if;

  return query
  select l.* from public.attendance_impact_ledger l
  left join public.staff s on s.id=l.staff_id
  where (p_staff_id is null or l.staff_id=p_staff_id)
    and (p_start is null or l.attendance_date>=p_start)
    and (p_end is null or l.attendance_date<=p_end)
    and public.dawaa_can_read_staff_attendance_log(l.staff_id,s.branch)
  order by l.attendance_date desc,l.created_at desc
  limit greatest(1,least(coalesce(p_limit,300),1000));
end;
$function$;

revoke all on function public.get_attendance_impact_ledger_v2(uuid,date,date,integer) from public,anon;
grant execute on function public.get_attendance_impact_ledger_v2(uuid,date,date,integer) to authenticated,service_role;

-- Safety reconciliation. Active shifts and sync-incomplete worked days are explicitly non-finalizable.
do $block$
declare v_job_id bigint;
begin
  if exists(select 1 from pg_extension where extname='pg_cron') then
    select jobid into v_job_id from cron.job where jobname='attendance-resolution-v2-reconcile' limit 1;
    if v_job_id is not null then perform cron.unschedule(v_job_id); end if;
    perform cron.schedule(
      'attendance-resolution-v2-reconcile',
      '*/15 * * * *',
      $cron$select public.dawaa_materialize_attendance_range_internal_v2(((now() at time zone 'Africa/Cairo')::date-1),(now() at time zone 'Africa/Cairo')::date,null);$cron$
    );
  end if;
end;
$block$;

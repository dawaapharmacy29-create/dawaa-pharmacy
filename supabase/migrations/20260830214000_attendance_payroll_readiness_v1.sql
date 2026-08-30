-- Align fingerprint promotion with canonical attendance identity and expose a read-only payroll readiness summary.

create or replace function public.dawaa_promote_biometric_attendance_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_map record;
  v_account public.staff_accounts%rowtype;
  v_type text;
  v_account_id uuid;
  v_subject_id uuid;
  v_branch text:=new.branch;
  v_device_key text:=coalesce(new.device_id::text,'*');
  v_staff_id_text text;
begin
  if new.staff_id is not null then
    select a.* into v_account
    from public.staff_accounts a
    where a.id=new.staff_id or trim(coalesce(a.staff_id,''))=new.staff_id::text
    order by (a.id=new.staff_id) desc
    limit 1;
  end if;

  if v_account.id is null and nullif(trim(new.biometric_user_id),'') is not null then
    select m.staff_account_id,m.branch into v_map
    from public.biometric_staff_mapping m
    where m.active=true
      and m.provider=new.provider
      and m.biometric_user_id=new.biometric_user_id
      and (m.device_id=v_device_key or m.device_id='*')
    order by (m.device_id=v_device_key) desc,m.updated_at desc
    limit 1;
    v_account_id:=v_map.staff_account_id;
    if v_branch is null then v_branch:=v_map.branch; end if;
    if v_account_id is not null then
      select a.* into v_account from public.staff_accounts a where a.id=v_account_id limit 1;
    end if;
  end if;

  if v_account.id is null and nullif(trim(new.biometric_user_id),'') is not null then
    select a.* into v_account
    from public.staff_accounts a
    where coalesce(a.active,a.is_active,true)=true
      and trim(coalesce(a.staff_id,''))=trim(new.biometric_user_id)
    limit 1;
  end if;

  if v_account.id is null then return null; end if;

  v_staff_id_text:=nullif(trim(coalesce(v_account.staff_id,'')),'');
  if v_staff_id_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_subject_id:=v_staff_id_text::uuid;
  else
    v_subject_id:=v_account.id;
  end if;
  v_branch:=coalesce(v_branch,v_account.branch);

  update public.biometric_attendance_logs
  set staff_id=v_subject_id,
      staff_name_snapshot=coalesce(staff_name_snapshot,coalesce(v_account.staff_name,v_account.name,v_account.username)),
      branch=coalesce(branch,v_branch)
  where id=new.id;

  v_type:=case lower(trim(coalesce(new.punch_type,'')))
    when 'check_in' then 'check_in'
    when 'in' then 'check_in'
    when 'check_out' then 'check_out'
    when 'out' then 'check_out'
    else null end;

  if v_type is not null and new.punch_time is not null then
    insert into public.staff_attendance_logs(
      staff_id,staff_name,role,branch_name,attendance_type,recorded_at,shift_date,
      biometric_verified,biometric_method,device_id,status,biometric_source_log_id
    ) values(
      v_subject_id,coalesce(v_account.staff_name,v_account.name,v_account.username),v_account.role,v_branch,
      v_type,new.punch_time,(new.punch_time at time zone 'Africa/Cairo')::date,
      true,'fingerprint_terminal',new.device_id::text,'accepted',new.id
    )
    on conflict(biometric_source_log_id) where biometric_source_log_id is not null do nothing;
  end if;
  return null;
end;
$function$;

-- Trigger helpers are internal implementation details, never client RPCs.
revoke all on function public.dawaa_promote_biometric_attendance_v1() from public,anon,authenticated;
grant execute on function public.dawaa_promote_biometric_attendance_v1() to service_role;

create or replace function public.get_attendance_payroll_readiness_v1(
  p_staff_id uuid,
  p_month_cycle text default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_cycle text:=coalesce(nullif(trim(coalesce(p_month_cycle,'')),''),public.dawaa_current_points_cycle_label_v1());
  v_start date;
  v_end date;
  v_username text;
  v_name text;
  v_raw_count integer:=0;
  v_accepted integer:=0;
  v_manual integer:=0;
  v_rejected integer:=0;
  v_pairs integer:=0;
  v_unpaired integer:=0;
  v_hours numeric:=0;
  v_ready boolean:=false;
  v_status text;
  v_reasons jsonb:='[]'::jsonb;
begin
  if p_staff_id is null then raise exception 'attendance_payroll_staff_identity_missing'; end if;

  select sa.username,coalesce(sa.staff_name,sa.name,sa.username)
    into v_username,v_name
  from public.staff_accounts sa
  where trim(coalesce(sa.staff_id,''))=p_staff_id::text or sa.id=p_staff_id
  order by (trim(coalesce(sa.staff_id,''))=p_staff_id::text) desc,coalesce(sa.active,true) desc
  limit 1;
  if v_username is null then raise exception 'attendance_payroll_staff_identity_missing'; end if;
  if not public.dawaa_can_manage_payroll_staff_v1(v_username) then
    raise exception 'not_authorized_for_payroll_staff' using errcode='42501';
  end if;

  v_start:=public.dawaa_points_cycle_start_for_label_v1(v_cycle);
  v_end:=public.dawaa_points_cycle_end_for_label_v1(v_cycle);

  select count(*)::integer into v_raw_count
  from public.biometric_attendance_logs b
  where b.staff_id=p_staff_id
    and b.punch_time >= (v_start::timestamp at time zone 'Africa/Cairo')
    and b.punch_time < (((v_end+1)::timestamp + interval '18 hours') at time zone 'Africa/Cairo');

  select
    count(*) filter(where a.status='accepted')::integer,
    count(*) filter(where a.status='manual_review')::integer,
    count(*) filter(where a.status='rejected')::integer
  into v_accepted,v_manual,v_rejected
  from public.staff_attendance_logs a
  where a.staff_id=p_staff_id
    and a.biometric_source_log_id is not null
    and coalesce(a.biometric_verified,false)=true
    and a.biometric_method='fingerprint_terminal'
    and a.recorded_at >= (v_start::timestamp at time zone 'Africa/Cairo')
    and a.recorded_at < (((v_end+1)::timestamp + interval '18 hours') at time zone 'Africa/Cairo');

  with ordered as (
    select a.id,a.attendance_type,a.recorded_at,
           lead(a.attendance_type) over(order by a.recorded_at,a.id) next_type,
           lead(a.recorded_at) over(order by a.recorded_at,a.id) next_time
    from public.staff_attendance_logs a
    where a.staff_id=p_staff_id
      and a.biometric_source_log_id is not null
      and coalesce(a.biometric_verified,false)=true
      and a.biometric_method='fingerprint_terminal'
      and a.status='accepted'
      and a.recorded_at >= (v_start::timestamp at time zone 'Africa/Cairo')
      and a.recorded_at < (((v_end+1)::timestamp + interval '18 hours') at time zone 'Africa/Cairo')
  ), pairs as (
    select * from ordered
    where attendance_type='check_in' and next_type='check_out'
      and next_time>recorded_at and next_time<=recorded_at+interval '18 hours'
      and (recorded_at at time zone 'Africa/Cairo')::date between v_start and v_end
  )
  select count(*)::integer,coalesce(round(sum(extract(epoch from (next_time-recorded_at))/3600.0)::numeric,2),0)
  into v_pairs,v_hours from pairs;

  v_unpaired:=greatest(0,coalesce(v_accepted,0)-(coalesce(v_pairs,0)*2));
  if v_raw_count=0 then v_reasons:=v_reasons||jsonb_build_array('no_biometric_events'); end if;
  if coalesce(v_manual,0)>0 then v_reasons:=v_reasons||jsonb_build_array('manual_review_events'); end if;
  if coalesce(v_rejected,0)>0 then v_reasons:=v_reasons||jsonb_build_array('rejected_events'); end if;
  if coalesce(v_pairs,0)=0 and v_raw_count>0 then v_reasons:=v_reasons||jsonb_build_array('no_complete_checkin_checkout_pairs'); end if;
  if v_unpaired>0 then v_reasons:=v_reasons||jsonb_build_array('unpaired_accepted_punches'); end if;

  v_ready:=v_raw_count>0 and v_pairs>0 and coalesce(v_manual,0)=0 and coalesce(v_rejected,0)=0 and v_unpaired=0;
  v_status:=case when v_raw_count=0 then 'no_data' when v_ready then 'ready' else 'needs_review' end;

  return jsonb_build_object(
    'staff_id',p_staff_id,'staff_name',v_name,'month_cycle',v_cycle,'cycle_start',v_start,'cycle_end',v_end,
    'raw_biometric_events',v_raw_count,'accepted_punches',coalesce(v_accepted,0),'manual_review_punches',coalesce(v_manual,0),
    'rejected_punches',coalesce(v_rejected,0),'paired_shifts',coalesce(v_pairs,0),'unpaired_accepted_punches',v_unpaired,
    'candidate_worked_hours',v_hours,'ready_for_payroll',v_ready,'status',v_status,'reasons',v_reasons,
    'pairing_policy','adjacent check_in -> check_out, max 18h, check-in date inside 26→25 cycle',
    'generated_at',now()
  );
end;
$function$;

revoke all on function public.get_attendance_payroll_readiness_v1(uuid,text) from public;
grant execute on function public.get_attendance_payroll_readiness_v1(uuid,text) to anon,authenticated,service_role;

create or replace function public.attendance_policy_enforce_preflight_v1(
  p_scope_type text,
  p_scope_key text default null,
  p_start date default null,
  p_end date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_key text:=nullif(trim(coalesce(p_scope_key,'')),'');
  v_end date:=coalesce(p_end,(now() at time zone 'Africa/Cairo')::date);
  v_start date:=coalesce(p_start,v_end-14);
  v_checked integer:=0;
  v_dates integer:=0;
  v_effective_changes integer:=0;
  v_candidate_changes integer:=0;
  v_shadow integer:=0;
  v_enforced integer:=0;
  v_unresolved integer:=0;
  v_ready boolean:=false;
  v_reason text:='';
  v_samples jsonb:='[]'::jsonb;
begin
  select * into v_actor
  from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true
    and coalesce(can_login,false)=true;

  if not found then
    raise exception 'active staff actor required' using errcode='42501';
  end if;

  if coalesce(v_actor.role,'') not in ('general_manager','admin','executive_manager','branches_manager') then
    raise exception 'not_authorized_for_policy_preflight' using errcode='42501';
  end if;

  if p_scope_type not in ('staff','role','branch','default') then
    raise exception 'invalid_rollout_scope' using errcode='22023';
  end if;

  if p_scope_type='default' then
    return jsonb_build_object(
      'ready',false,
      'reason','global_enforce_disabled_during_pilot',
      'scope_type',p_scope_type,
      'scope_key',null,
      'start_date',v_start,
      'end_date',v_end,
      'checked_days',0,
      'evaluated_dates',0,
      'effective_status_changes',0,
      'candidate_changes',0,
      'shadow_days',0,
      'enforced_days',0,
      'unresolved_policy_days',0,
      'samples','[]'::jsonb
    );
  end if;

  if v_key is null then
    raise exception 'rollout_scope_key_required' using errcode='22023';
  end if;

  if v_start is null or v_end is null or v_end<v_start or v_end-v_start>45 then
    raise exception 'invalid_enforce_preflight_range' using errcode='22023';
  end if;

  with eligible as (
    select a.staff_id,a.attendance_date,a.branch,s.name staff_name,s.role
    from public.attendance_daily_summary a
    join public.staff s on s.id=a.staff_id
    where a.attendance_date between v_start and v_end
      and (
        (p_scope_type='staff' and a.staff_id::text=v_key)
        or (p_scope_type='role' and lower(trim(coalesce(s.role,'')))=lower(v_key))
        or (p_scope_type='branch' and trim(coalesce(a.branch,''))=v_key)
      )
  ), compared as (
    select e.*,
      public.dawaa_build_attendance_day_resolution_v2(e.staff_id,e.attendance_date) v2,
      public.dawaa_build_attendance_day_resolution_v3(e.staff_id,e.attendance_date) v3
    from eligible e
  ), totals as (
    select
      count(*)::integer checked_days,
      count(distinct attendance_date)::integer evaluated_dates,
      count(*) filter (where v2->>'resolution_status' is distinct from v3->>'resolution_status')::integer effective_status_changes,
      count(*) filter (where coalesce((v3->>'policy_candidate_changed')::boolean,false))::integer candidate_changes,
      count(*) filter (where v3->>'policy_rollout_mode'='shadow')::integer shadow_days,
      count(*) filter (where v3->>'policy_rollout_mode'='enforce')::integer enforced_days,
      count(*) filter (where nullif(v3->>'resolved_policy_version','') is null)::integer unresolved_policy_days
    from compared
  )
  select checked_days,evaluated_dates,effective_status_changes,candidate_changes,shadow_days,enforced_days,unresolved_policy_days
  into v_checked,v_dates,v_effective_changes,v_candidate_changes,v_shadow,v_enforced,v_unresolved
  from totals;

  with eligible as (
    select a.staff_id,a.attendance_date,a.branch,s.name staff_name,s.role
    from public.attendance_daily_summary a
    join public.staff s on s.id=a.staff_id
    where a.attendance_date between v_start and v_end
      and (
        (p_scope_type='staff' and a.staff_id::text=v_key)
        or (p_scope_type='role' and lower(trim(coalesce(s.role,'')))=lower(v_key))
        or (p_scope_type='branch' and trim(coalesce(a.branch,''))=v_key)
      )
  ), compared as (
    select e.*,
      public.dawaa_build_attendance_day_resolution_v2(e.staff_id,e.attendance_date) v2,
      public.dawaa_build_attendance_day_resolution_v3(e.staff_id,e.attendance_date) v3
    from eligible e
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'staff_id',x.staff_id,
    'staff_name',x.staff_name,
    'branch',x.branch,
    'attendance_date',x.attendance_date,
    'v2_status',x.v2->>'resolution_status',
    'v3_status',x.v3->>'resolution_status',
    'candidate_status',x.v3->>'policy_candidate_status',
    'rollout_mode',x.v3->>'policy_rollout_mode',
    'policy_version',x.v3->>'resolved_policy_version'
  ) order by x.attendance_date desc,x.staff_name),'[]'::jsonb)
  into v_samples
  from (
    select *
    from compared
    where (v2->>'resolution_status' is distinct from v3->>'resolution_status')
       or coalesce((v3->>'policy_candidate_changed')::boolean,false)
       or nullif(v3->>'resolved_policy_version','') is null
    order by attendance_date desc,staff_name
    limit 30
  ) x;

  if v_checked=0 then
    v_reason:='no_attendance_data_for_scope';
  elsif v_dates<7 then
    v_reason:='insufficient_shadow_history';
  elsif v_effective_changes>0 then
    v_reason:='v2_v3_effective_mismatch';
  elsif v_unresolved>0 then
    v_reason:='unresolved_policy_days';
  elsif v_enforced>0 then
    v_reason:='scope_already_contains_enforced_days';
  elsif v_shadow<>v_checked then
    v_reason:='not_all_scope_days_are_shadow';
  else
    v_ready:=true;
    v_reason:=case when v_candidate_changes>0 then 'ready_with_candidate_changes_for_review' else 'ready' end;
  end if;

  return jsonb_build_object(
    'ready',v_ready,
    'reason',v_reason,
    'scope_type',p_scope_type,
    'scope_key',v_key,
    'start_date',v_start,
    'end_date',v_end,
    'checked_days',v_checked,
    'evaluated_dates',v_dates,
    'effective_status_changes',v_effective_changes,
    'candidate_changes',v_candidate_changes,
    'shadow_days',v_shadow,
    'enforced_days',v_enforced,
    'unresolved_policy_days',v_unresolved,
    'samples',v_samples,
    'generated_at',now()
  );
end;
$$;

create or replace function public.set_attendance_policy_rollout_v1(
  p_scope_type text,
  p_scope_key text default null,
  p_mode text default 'shadow',
  p_effective_from date default null,
  p_effective_to date default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_key text:=nullif(trim(coalesce(p_scope_key,'')),'');
  v_date date:=coalesce(p_effective_from,(now() at time zone 'Africa/Cairo')::date);
  v_rollout public.attendance_policy_rollout_assignments%rowtype;
  v_preflight jsonb:=null;
begin
  select * into v_actor from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true and coalesce(can_login,false)=true;
  if not found then raise exception 'active staff actor required' using errcode='42501'; end if;
  if coalesce(v_actor.role,'') not in ('general_manager','admin','executive_manager','branches_manager') then
    raise exception 'not_authorized_for_policy_write' using errcode='42501';
  end if;

  if p_scope_type not in ('staff','role','branch','default') then raise exception 'invalid_rollout_scope' using errcode='22023'; end if;
  if p_mode not in ('off','shadow','enforce') then raise exception 'invalid_rollout_mode' using errcode='22023'; end if;
  if p_scope_type='default' then v_key:=null;
  elsif v_key is null then raise exception 'rollout_scope_key_required' using errcode='22023';
  end if;
  if p_effective_to is not null and p_effective_to<v_date then raise exception 'invalid_rollout_range' using errcode='22023'; end if;

  if p_mode='enforce' then
    if p_scope_type='default' then
      raise exception 'global_enforce_disabled_during_pilot' using errcode='22023';
    end if;

    v_preflight:=public.attendance_policy_enforce_preflight_v1(
      p_scope_type,
      v_key,
      (now() at time zone 'Africa/Cairo')::date-14,
      (now() at time zone 'Africa/Cairo')::date
    );

    if not coalesce((v_preflight->>'ready')::boolean,false) then
      raise exception 'enforce_preflight_failed:%',coalesce(v_preflight->>'reason','unknown')
        using errcode='22023';
    end if;
  end if;

  update public.attendance_policy_rollout_assignments
  set effective_to=v_date-1,updated_at=now()
  where active=true
    and scope_type=p_scope_type
    and coalesce(scope_key,'')=coalesce(v_key,'')
    and effective_from<v_date
    and (effective_to is null or effective_to>=v_date);

  insert into public.attendance_policy_rollout_assignments(
    scope_type,scope_key,mode,effective_from,effective_to,active,note,created_by
  )
  values(p_scope_type,v_key,p_mode,v_date,p_effective_to,true,nullif(trim(coalesce(p_note,'')),''),v_actor.id)
  returning * into v_rollout;

  insert into public.attendance_policy_change_audit(
    action,actor_id,actor_name,rollout_assignment_id,scope_type,scope_key,effective_from,effective_to,after_snapshot,note
  )
  values(
    case when p_mode='enforce' then 'rollout_enforce_after_preflight' else 'rollout_set' end,
    v_actor.id,coalesce(v_actor.name,v_actor.username),v_rollout.id,p_scope_type,v_key,
    v_date,p_effective_to,
    case when v_preflight is null then to_jsonb(v_rollout)
      else jsonb_build_object('rollout',to_jsonb(v_rollout),'preflight',v_preflight) end,
    nullif(trim(coalesce(p_note,'')),'')
  );

  return jsonb_build_object(
    'success',true,
    'rollout',to_jsonb(v_rollout),
    'preflight',v_preflight
  );
end;
$$;

revoke execute on function public.attendance_policy_enforce_preflight_v1(text,text,date,date) from public,anon;
grant execute on function public.attendance_policy_enforce_preflight_v1(text,text,date,date) to authenticated,service_role;

revoke execute on function public.set_attendance_policy_rollout_v1(text,text,text,date,date,text) from public,anon;
grant execute on function public.set_attendance_policy_rollout_v1(text,text,text,date,date,text) to authenticated,service_role;

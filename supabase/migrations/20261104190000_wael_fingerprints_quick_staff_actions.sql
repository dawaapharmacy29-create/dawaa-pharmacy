CREATE OR REPLACE FUNCTION public.hr_staff_lifecycle_change_v2(p_action text, p_staff_id uuid DEFAULT NULL::uuid, p_change_id uuid DEFAULT NULL::uuid, p_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_actor public.staff_accounts%rowtype;
  v_staff public.staff%rowtype;
  v_row public.hr_staff_lifecycle_changes_v2%rowtype;
  v_action text:=lower(trim(coalesce(p_action,'')));
  v_effective date;
  v_last date;
  v_target text;
  v_kind text;
  v_reason text;
  v_note text;
  v_id uuid;
begin
  select * into v_actor
  from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true
    and coalesce(can_login,false)=true;

  if not found or coalesce(v_actor.role,'') not in ('general_manager','admin','executive_manager','branches_manager') then
    raise exception 'not_authorized_for_staff_lifecycle_change' using errcode='42501';
  end if;

  if v_action='list_pending' then
    return coalesce((
      select jsonb_agg(to_jsonb(x) order by x.requested_at)
      from (
        select c.id,c.staff_id,s.name staff_name,s.branch,s.role,c.effective_from,c.target_state,c.last_working_date,
          c.separation_kind,c.reason,c.state,c.requested_at,coalesce(req.name,req.username) requested_by_name
        from public.hr_staff_lifecycle_changes_v2 c
        join public.staff s on s.id=c.staff_id
        left join public.staff_accounts req on req.id=c.requested_by
        where c.state='pending'
        order by c.requested_at
        limit 200
      ) x
    ),'[]'::jsonb);
  end if;

  if v_action='archive_now' then
    if v_actor.role <> 'general_manager' then
      raise exception 'staff_lifecycle_direct_archive_requires_general_manager' using errcode='42501';
    end if;
    perform public.dr_wael_fingerprints_actor_v1();
    select * into v_staff from public.staff where id=p_staff_id for update;
    if not found or coalesce(v_staff.branch,'') not in ('فرع شكري','فرع الشامي','المخزن')
      or v_staff.is_active is not true or p_staff_id::text = v_actor.staff_id then
      raise exception 'staff_not_in_scope' using errcode='22023';
    end if;
    v_last:=nullif(p_payload->>'last_working_date','')::date;
    v_effective:=v_last+1;
    v_kind:=nullif(trim(p_payload->>'separation_kind'),'');
    v_reason:=coalesce(nullif(trim(p_payload->>'reason'),''),'أرشفة مباشرة من بصمات د وائل');
    if v_last is null or v_last >= (now() at time zone 'Africa/Cairo')::date
      or v_kind is null or v_kind not in ('resignation','termination','contract_end','retirement','transfer_out','other') then
      raise exception 'invalid_staff_lifecycle_request' using errcode='22023';
    end if;
    if exists(select 1 from public.hr_staff_lifecycle_changes_v2 c
      where c.staff_id=p_staff_id and (c.state='pending' or (c.state='approved' and c.effective_from>v_effective))) then
      raise exception 'pending_staff_lifecycle_change_already_exists' using errcode='23505';
    end if;
    insert into public.hr_staff_lifecycle_changes_v2(
      staff_id,effective_from,target_state,last_working_date,separation_kind,reason,state,requested_by,
      previous_staff_status,previous_active,previous_is_active,previous_visible_in_schedule,
      decided_by,decided_at,decision_note
    ) values(
      p_staff_id,v_effective,'archived',v_last,v_kind,v_reason,'approved',v_actor.id,
      v_staff.status,v_staff.active,v_staff.is_active,v_staff.visible_in_schedule,
      v_actor.id,now(),'أرشفة مباشرة باعتماد المدير العام من بصمات د وائل'
    ) returning id into v_id;
    perform public.hr_apply_due_staff_lifecycle_v2(p_staff_id);
    return jsonb_build_object('success',true,'id',v_id,'state','approved');
  end if;

  if v_action='request' then
    select * into v_staff from public.staff where id=p_staff_id;
    if not found then raise exception 'staff_not_found' using errcode='22023'; end if;

    v_effective:=nullif(p_payload->>'effective_from','')::date;
    v_target:=lower(trim(coalesce(p_payload->>'target_state','')));
    v_last:=nullif(p_payload->>'last_working_date','')::date;
    v_kind:=nullif(lower(trim(coalesce(p_payload->>'separation_kind',''))),'');
    v_reason:=nullif(trim(coalesce(p_payload->>'reason','')),'');

    if v_effective is null or v_target not in ('active','leaving','archived') or length(coalesce(v_reason,''))<3 then
      raise exception 'invalid_staff_lifecycle_request' using errcode='22023';
    end if;
    if v_target='leaving' and (v_last is null or v_last<v_effective) then
      raise exception 'leaving_requires_valid_last_working_date' using errcode='22023';
    end if;
    if v_target in ('leaving','archived') and v_kind is null then
      raise exception 'separation_kind_required' using errcode='22023';
    end if;
    if v_kind is not null and v_kind not in ('resignation','termination','contract_end','retirement','transfer_out','other') then
      raise exception 'invalid_separation_kind' using errcode='22023';
    end if;
    if exists(select 1 from public.hr_staff_lifecycle_changes_v2 c where c.staff_id=p_staff_id and c.state='pending') then
      raise exception 'pending_staff_lifecycle_change_already_exists' using errcode='23505';
    end if;

    insert into public.hr_staff_lifecycle_changes_v2(
      staff_id,effective_from,target_state,last_working_date,separation_kind,reason,state,requested_by,
      previous_staff_status,previous_active,previous_is_active,previous_visible_in_schedule
    )
    values(
      p_staff_id,v_effective,v_target,v_last,v_kind,v_reason,'pending',v_actor.id,
      v_staff.status,v_staff.active,v_staff.is_active,v_staff.visible_in_schedule
    )
    returning id into v_id;

    return jsonb_build_object('success',true,'id',v_id,'state','pending');
  end if;

  if v_action='cancel' then
    select * into v_row from public.hr_staff_lifecycle_changes_v2 where id=p_change_id for update;
    if not found or v_row.state<>'pending' then
      raise exception 'staff_lifecycle_change_not_found_or_closed' using errcode='22023';
    end if;
    if v_row.requested_by<>v_actor.id and coalesce(v_actor.role,'') not in ('general_manager','executive_manager') then
      raise exception 'not_authorized_to_cancel_staff_lifecycle_change' using errcode='42501';
    end if;
    update public.hr_staff_lifecycle_changes_v2
    set state='cancelled',decided_by=v_actor.id,decided_at=now(),
        decision_note=nullif(trim(coalesce(p_payload->>'note','')),'')
    where id=v_row.id;
    return jsonb_build_object('success',true,'id',v_row.id,'state','cancelled');
  end if;

  if v_action not in ('approve','reject') then
    raise exception 'invalid_staff_lifecycle_action' using errcode='22023';
  end if;

  if coalesce(v_actor.role,'') not in ('general_manager','executive_manager') then
    raise exception 'staff_lifecycle_decision_requires_top_management' using errcode='42501';
  end if;

  select * into v_row
  from public.hr_staff_lifecycle_changes_v2
  where id=p_change_id
  for update;

  if not found or v_row.state<>'pending' then
    raise exception 'staff_lifecycle_change_not_found_or_closed' using errcode='22023';
  end if;

  if v_row.requested_by=v_actor.id and not (
    v_actor.role='general_manager' and v_action='approve'
    and v_row.target_state='archived' and v_row.separation_kind='transfer_out'
  ) then
    raise exception 'staff_lifecycle_requester_cannot_approve_own_request' using errcode='42501';
  end if;

  v_note:=nullif(trim(coalesce(p_payload->>'note','')),'');
  if v_action='reject' and v_note is null then
    raise exception 'staff_lifecycle_rejection_reason_required' using errcode='22023';
  end if;

  update public.hr_staff_lifecycle_changes_v2
  set state=case when v_action='approve' then 'approved' else 'rejected' end,
      decided_by=v_actor.id,
      decided_at=now(),
      decision_note=v_note
  where id=v_row.id
  returning * into v_row;

  if v_action='approve' then
    perform public.hr_apply_due_staff_lifecycle_v2(v_row.staff_id);
  end if;

  return jsonb_build_object(
    'success',true,
    'id',v_row.id,
    'state',case when v_action='approve' then 'approved' else 'rejected' end,
    'effective_from',v_row.effective_from,
    'target_state',v_row.target_state
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.dr_wael_set_leave_v1(p_staff_id uuid, p_kind text, p_from date, p_to date, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  v_actor uuid := public.dr_wael_fingerprints_actor_v1();
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_labels jsonb := '{"approved_absence":"إجازة بإذن الإدارة","annual_leave":"إجازة اعتيادية","sick_leave":"إجازة مرضي","exceptional_leave":"إجازة استثنائية"}';
  v_reason text := coalesce(nullif(trim(p_reason), ''), 'إجازة لفترة من بصمات د وائل');
  v_request public.staff_time_off_requests%rowtype;
  v_decided public.staff_time_off_requests%rowtype;
begin
  if p_staff_id is null or p_from is null or p_to is null or p_to < p_from or not (v_labels ? coalesce(p_kind, '')) then
    raise exception 'invalid_leave_request' using errcode = '22023';
  end if;
  if p_to - p_from > 364 or p_from < v_today - 40 or p_from > v_today + 120 then
    raise exception 'leave_period_out_of_range' using errcode = '22023';
  end if;
  if not exists (select 1 from public.staff s where s.id = p_staff_id and s.is_active is true
                   and s.branch in ('فرع شكري', 'فرع الشامي', 'المخزن')) then
    raise exception 'staff_not_in_scope' using errcode = '22023';
  end if;

  v_request := public.create_staff_time_off_request_v1(
    p_staff_id, p_kind, v_labels->>p_kind, p_from, p_to, null, null, null, v_reason);
  v_decided := public.decide_staff_time_off_request_v3(v_request.id, 'approved', v_reason);

  insert into public.dr_wael_change_log_v1(kind, staff_id, payload, actor_id)
  values ('leave', p_staff_id, jsonb_build_object('request_id', v_decided.id, 'kind', p_kind, 'from', p_from,
    'to', p_to, 'reason', v_reason), v_actor);

  return jsonb_build_object('success', true, 'request_id', v_decided.id, 'status', v_decided.status,
    'from', v_decided.start_date, 'to', v_decided.end_date);
end;
$function$;

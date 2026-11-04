-- Permit the general manager to approve their own branch-only transfer.
-- Preserve the separate approver for role changes and lifecycle requests.
create or replace function public.hr_staff_assignment_change_v2(
  p_action text,
  p_staff_id uuid default null,
  p_assignment_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_staff public.staff%rowtype;
  v_row public.hr_staff_assignment_versions_v2%rowtype;
  v_effective date;
  v_branch text;
  v_role text;
  v_reason text;
  v_note text;
  v_id uuid;
  v_action text:=lower(trim(coalesce(p_action,'')));
begin
  select * into v_actor
  from public.staff_accounts
  where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false)=true
    and coalesce(can_login,false)=true;

  if not found or coalesce(v_actor.role,'') not in ('general_manager','admin','executive_manager','branches_manager') then
    raise exception 'not_authorized_for_staff_assignment_change' using errcode='42501';
  end if;

  if v_action='list_pending' then
    return coalesce((
      select jsonb_agg(to_jsonb(x) order by x.requested_at)
      from (
        select a.id,a.staff_id,s.name staff_name,a.effective_from,a.branch,a.role,a.change_reason,
          a.state,a.requested_at,coalesce(req.name,req.username) requested_by_name
        from public.hr_staff_assignment_versions_v2 a
        join public.staff s on s.id=a.staff_id
        left join public.staff_accounts req on req.id=a.requested_by
        where a.state='pending'
        order by a.requested_at
        limit 200
      ) x
    ),'[]'::jsonb);
  end if;

  if v_action='request' then
    select * into v_staff from public.staff where id=p_staff_id;
    if not found then raise exception 'staff_not_found' using errcode='22023'; end if;

    v_effective:=nullif(p_payload->>'effective_from','')::date;
    v_branch:=nullif(trim(p_payload->>'branch'),'');
    v_role:=nullif(trim(p_payload->>'role'),'');
    v_reason:=nullif(trim(p_payload->>'reason'),'');

    if v_effective is null or v_branch is null or v_role is null or length(coalesce(v_reason,''))<3 then
      raise exception 'invalid_staff_assignment_request' using errcode='22023';
    end if;

    if exists(
      select 1 from public.hr_staff_assignment_versions_v2 a
      where a.staff_id=p_staff_id and a.state='pending'
    ) then
      raise exception 'pending_staff_assignment_already_exists' using errcode='23505';
    end if;

    insert into public.hr_staff_assignment_versions_v2(
      staff_id,effective_from,branch,role,change_reason,state,requested_by,previous_branch,previous_role
    )
    values(
      p_staff_id,v_effective,v_branch,v_role,v_reason,'pending',v_actor.id,v_staff.branch,v_staff.role
    )
    returning id into v_id;

    return jsonb_build_object('success',true,'id',v_id,'state','pending');
  end if;

  if v_action not in ('approve','reject') then
    raise exception 'invalid_staff_assignment_action' using errcode='22023';
  end if;

  if coalesce(v_actor.role,'') not in ('general_manager','executive_manager') then
    raise exception 'staff_assignment_decision_requires_top_management' using errcode='42501';
  end if;

  select * into v_row
  from public.hr_staff_assignment_versions_v2
  where id=p_assignment_id
  for update;

  if not found or v_row.state<>'pending' then
    raise exception 'staff_assignment_not_found_or_closed' using errcode='22023';
  end if;
  if v_row.requested_by=v_actor.id and not (
    v_actor.role='general_manager' and v_action='approve'
    and v_row.branch is distinct from v_row.previous_branch
    and v_row.role is not distinct from v_row.previous_role
    and exists (select 1 from public.staff s where s.id=v_row.staff_id
      and s.branch is not distinct from v_row.previous_branch
      and s.role is not distinct from v_row.previous_role)
  ) then
    raise exception 'staff_assignment_requester_cannot_approve_own_request' using errcode='42501';
  end if;

  v_note:=nullif(trim(p_payload->>'note'),'');
  if v_action='reject' and v_note is null then
    raise exception 'staff_assignment_rejection_reason_required' using errcode='22023';
  end if;

  update public.hr_staff_assignment_versions_v2
  set state=case when v_action='approve' then 'approved' else 'rejected' end,
      decided_by=v_actor.id,
      decided_at=now(),
      decision_note=v_note
  where id=v_row.id
  returning * into v_row;

  if v_action='approve' and v_row.effective_from<=(now() at time zone 'Africa/Cairo')::date then
    update public.staff
    set branch=v_row.branch,
        role=v_row.role,
        updated_at=now()
    where id=v_row.staff_id;

    update public.hr_staff_assignment_versions_v2
    set applied_to_staff_at=now()
    where id=v_row.id;
  end if;

  return jsonb_build_object(
    'success',true,'id',v_row.id,'state',case when v_action='approve' then 'approved' else 'rejected' end,
    'effective_from',v_row.effective_from,
    'applied_now',v_action='approve' and v_row.effective_from<=(now() at time zone 'Africa/Cairo')::date
  );
end;
$$;

-- Effective-dated staff assignment V2.
-- Canonical history for branch/role changes while keeping public.staff as the current projection
-- for backwards compatibility during the migration period.

create table if not exists public.hr_staff_assignment_versions_v2 (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  effective_from date not null,
  branch text not null,
  role text not null,
  change_reason text not null check (length(trim(change_reason)) between 3 and 500),
  state text not null default 'pending' check (state in ('pending','approved','rejected')),
  requested_by uuid not null references public.staff_accounts(id) on delete restrict,
  requested_at timestamptz not null default now(),
  decided_by uuid references public.staff_accounts(id) on delete restrict,
  decided_at timestamptz,
  decision_note text,
  applied_to_staff_at timestamptz,
  previous_branch text,
  previous_role text,
  created_at timestamptz not null default now()
);

create index if not exists hr_staff_assignment_versions_v2_staff_idx
  on public.hr_staff_assignment_versions_v2(staff_id,effective_from desc,created_at desc);
create index if not exists hr_staff_assignment_versions_v2_pending_idx
  on public.hr_staff_assignment_versions_v2(requested_at desc)
  where state='pending';
create unique index if not exists hr_staff_assignment_versions_v2_one_approved_effective_idx
  on public.hr_staff_assignment_versions_v2(staff_id,effective_from)
  where state='approved';

alter table public.hr_staff_assignment_versions_v2 enable row level security;
revoke all on public.hr_staff_assignment_versions_v2 from public,anon,authenticated;
grant select,insert,update on public.hr_staff_assignment_versions_v2 to service_role;

create or replace function public.hr_staff_assignment_timeline_v2(
  p_staff_id uuid,
  p_as_of date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_staff public.staff%rowtype;
  v_date date:=coalesce(p_as_of,(now() at time zone 'Africa/Cairo')::date);
  v_current jsonb;
  v_history jsonb;
begin
  if p_staff_id is null then raise exception 'staff_id_required' using errcode='22023'; end if;
  select * into v_staff from public.staff where id=p_staff_id;
  if not found then raise exception 'staff_not_found' using errcode='22023'; end if;

  if not public.dawaa_can_read_staff_attendance_log(v_staff.id,v_staff.branch)
     and not public.dawaa_current_actor_can(array['view_staff_accounts','view_team','view_staff_details']) then
    raise exception 'not_authorized_for_staff_assignment' using errcode='42501';
  end if;

  select to_jsonb(x) into v_current
  from (
    select a.id,a.staff_id,a.effective_from,a.branch,a.role,a.change_reason,a.state,
      a.requested_at,a.decided_at,a.decision_note,a.applied_to_staff_at,
      coalesce(req.name,req.username) requested_by_name,
      coalesce(dec.name,dec.username) decided_by_name
    from public.hr_staff_assignment_versions_v2 a
    left join public.staff_accounts req on req.id=a.requested_by
    left join public.staff_accounts dec on dec.id=a.decided_by
    where a.staff_id=p_staff_id
      and a.state='approved'
      and a.effective_from<=v_date
    order by a.effective_from desc,a.decided_at desc nulls last,a.created_at desc
    limit 1
  ) x;

  if v_current is null then
    v_current:=jsonb_build_object(
      'id',null,'staff_id',v_staff.id,'effective_from',null,
      'branch',v_staff.branch,'role',v_staff.role,'change_reason','legacy_staff_projection',
      'state','legacy_projection','requested_at',null,'decided_at',null,
      'decision_note',null,'applied_to_staff_at',null,
      'requested_by_name',null,'decided_by_name',null
    );
  end if;

  select coalesce(jsonb_agg(to_jsonb(h) order by h.effective_from desc,h.requested_at desc),'[]'::jsonb)
  into v_history
  from (
    select a.id,a.staff_id,a.effective_from,a.branch,a.role,a.change_reason,a.state,
      a.requested_at,a.decided_at,a.decision_note,a.applied_to_staff_at,
      a.previous_branch,a.previous_role,
      coalesce(req.name,req.username) requested_by_name,
      coalesce(dec.name,dec.username) decided_by_name
    from public.hr_staff_assignment_versions_v2 a
    left join public.staff_accounts req on req.id=a.requested_by
    left join public.staff_accounts dec on dec.id=a.decided_by
    where a.staff_id=p_staff_id
    order by a.effective_from desc,a.requested_at desc
    limit 100
  ) h;

  return jsonb_build_object(
    'staff_id',v_staff.id,
    'staff_name',v_staff.name,
    'as_of',v_date,
    'current',v_current,
    'projection',jsonb_build_object('branch',v_staff.branch,'role',v_staff.role),
    'history',v_history,
    'generated_at',now()
  );
end;
$$;

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
  if v_row.requested_by=v_actor.id then
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

create or replace function public.hr_apply_due_staff_assignments_v2()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_today date:=(now() at time zone 'Africa/Cairo')::date;
  v_staff record;
  v_count integer:=0;
begin
  for v_staff in
    select distinct a.staff_id
    from public.hr_staff_assignment_versions_v2 a
    where a.state='approved'
      and a.effective_from<=v_today
      and a.applied_to_staff_at is null
  loop
    update public.staff s
    set branch=x.branch,role=x.role,updated_at=now()
    from lateral (
      select a.branch,a.role,a.id
      from public.hr_staff_assignment_versions_v2 a
      where a.staff_id=v_staff.staff_id
        and a.state='approved'
        and a.effective_from<=v_today
      order by a.effective_from desc,a.decided_at desc nulls last,a.created_at desc
      limit 1
    ) x
    where s.id=v_staff.staff_id;

    update public.hr_staff_assignment_versions_v2 a
    set applied_to_staff_at=coalesce(a.applied_to_staff_at,now())
    where a.staff_id=v_staff.staff_id
      and a.state='approved'
      and a.effective_from<=v_today;

    v_count:=v_count+1;
  end loop;

  return jsonb_build_object('success',true,'staff_projected',v_count,'as_of',v_today);
end;
$$;

revoke execute on function public.hr_staff_assignment_timeline_v2(uuid,date) from public;
revoke execute on function public.hr_staff_assignment_change_v2(text,uuid,uuid,jsonb) from public;
revoke execute on function public.hr_apply_due_staff_assignments_v2() from public,anon,authenticated;
grant execute on function public.hr_staff_assignment_timeline_v2(uuid,date) to anon,authenticated,service_role;
grant execute on function public.hr_staff_assignment_change_v2(text,uuid,uuid,jsonb) to anon,authenticated,service_role;
grant execute on function public.hr_apply_due_staff_assignments_v2() to service_role;

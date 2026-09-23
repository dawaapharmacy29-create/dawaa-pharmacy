-- Recruitment is separate from canonical staff identity until a reviewed hire is linked.
create table public.hr_candidates_v1 (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 160),
  phone text check (length(phone) <= 40),
  position_title text not null check (length(trim(position_title)) between 2 and 120),
  target_branch text not null check (length(trim(target_branch)) between 2 and 120),
  stage text not null default 'applied' check (stage in ('applied','screening','interview','offer','hired','rejected','withdrawn')),
  staff_id uuid unique references public.staff(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.staff_accounts(id),
  constraint hr_candidate_hire_link_v1 check ((stage='hired') = (staff_id is not null))
);
create index hr_candidates_queue_v1 on public.hr_candidates_v1(created_at desc,id desc);
create table public.hr_candidate_events_v1 (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references public.hr_candidates_v1(id) on delete restrict,
  from_stage text,
  to_stage text not null,
  note text check (length(note) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.staff_accounts(id)
);
create index hr_candidate_events_history_v1 on public.hr_candidate_events_v1(candidate_id,created_at desc);
alter table public.hr_candidates_v1 enable row level security;
alter table public.hr_candidate_events_v1 enable row level security;
revoke all on public.hr_candidates_v1,public.hr_candidate_events_v1 from public,anon,authenticated;

create function public.hr_recruitment_v1(p_action text,p_candidate_id uuid default null,p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_actor public.staff_accounts%rowtype; v_candidate public.hr_candidates_v1%rowtype;
  v_id uuid; v_next text; v_staff uuid; v_note text; v_result jsonb;
begin
  select * into v_actor from public.staff_accounts where id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false) and coalesce(can_login,false);
  if not found or v_actor.role not in ('general_manager','admin','executive_manager','branches_manager') then
    raise exception 'recruitment_not_authorized' using errcode='42501'; end if;
  if p_action='list' then
    select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc,c.id desc),'[]'::jsonb) into v_result
    from (select id,name,phone,position_title,target_branch,stage,staff_id,created_at
      from public.hr_candidates_v1 order by created_at desc,id desc limit 100) c;
    return v_result;
  end if;
  if p_action='create' then
    insert into public.hr_candidates_v1(name,phone,position_title,target_branch,created_by)
    values (trim(p_payload->>'name'),nullif(trim(p_payload->>'phone'),''),trim(p_payload->>'position_title'),
      trim(p_payload->>'target_branch'),v_actor.id) returning id into v_id;
    insert into public.hr_candidate_events_v1(candidate_id,to_stage,created_by)
      values(v_id,'applied',v_actor.id);
    return jsonb_build_object('id',v_id);
  end if;
  if p_action='history' then
    if not exists(select 1 from public.hr_candidates_v1 where id=p_candidate_id) then
      raise exception 'candidate_not_found' using errcode='22023'; end if;
    select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc,e.id desc),'[]'::jsonb) into v_result
    from (select id,from_stage,to_stage,note,created_at,created_by
      from public.hr_candidate_events_v1 where candidate_id=p_candidate_id
      order by created_at desc,id desc limit 100) e;
    return v_result;
  end if;
  if p_action<>'advance' then raise exception 'invalid_recruitment_action' using errcode='22023'; end if;
  select * into v_candidate from public.hr_candidates_v1 where id=p_candidate_id for update;
  if not found then raise exception 'candidate_not_found' using errcode='22023'; end if;
  v_next:=p_payload->>'stage'; v_note:=nullif(trim(p_payload->>'note'),'');
  if length(coalesce(v_note,''))>1000 or not (
    (v_candidate.stage='applied' and v_next in ('screening','rejected','withdrawn')) or
    (v_candidate.stage='screening' and v_next in ('interview','rejected','withdrawn')) or
    (v_candidate.stage='interview' and v_next in ('offer','rejected','withdrawn')) or
    (v_candidate.stage='offer' and v_next in ('hired','rejected','withdrawn'))
  ) then raise exception 'invalid_recruitment_transition' using errcode='22023'; end if;
  if v_next='hired' then
    v_staff:=nullif(p_payload->>'staff_id','')::uuid;
    if v_staff is null or not exists(select 1 from public.staff where id=v_staff) then
      raise exception 'existing_staff_required_for_hire' using errcode='22023'; end if;
  elsif p_payload ? 'staff_id' and nullif(p_payload->>'staff_id','') is not null then
    raise exception 'staff_only_on_hire' using errcode='22023';
  end if;
  update public.hr_candidates_v1 set stage=v_next,staff_id=v_staff where id=v_candidate.id;
  insert into public.hr_candidate_events_v1(candidate_id,from_stage,to_stage,note,created_by)
    values(v_candidate.id,v_candidate.stage,v_next,v_note,v_actor.id);
  return jsonb_build_object('id',v_candidate.id,'stage',v_next);
end $$;
revoke execute on function public.hr_recruitment_v1(text,uuid,jsonb) from public;
grant execute on function public.hr_recruitment_v1(text,uuid,jsonb) to anon,authenticated,service_role;

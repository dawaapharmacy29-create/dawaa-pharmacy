-- Employee lifecycle tasks are operational records, separate from payroll and staff identity.
create table public.hr_staff_milestones_v1 (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  kind text not null check (kind in ('onboarding','document','training','offboarding')),
  title text not null check (length(trim(title)) between 3 and 160),
  due_on date,
  note text check (length(coalesce(note,'')) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid not null references public.staff_accounts(id),
  completed_at timestamptz,
  completed_by uuid references public.staff_accounts(id),
  constraint milestone_completion_pair check ((completed_at is null) = (completed_by is null))
);
create index hr_staff_milestones_staff_open_idx on public.hr_staff_milestones_v1(staff_id, completed_at, due_on);
alter table public.hr_staff_milestones_v1 enable row level security;
revoke all on public.hr_staff_milestones_v1 from public, anon, authenticated;

create function public.hr_list_staff_milestones_v1(p_staff_id uuid, p_limit integer default 100)
returns table(id uuid, staff_id uuid, kind text, title text, due_on date, note text,
  created_at timestamptz, created_by_name text, completed_at timestamptz, completed_by_name text)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_actor public.staff_accounts%rowtype; v_staff public.staff%rowtype;
begin
  select * into v_actor from public.staff_accounts
    where staff_accounts.id=public.dawaa_current_staff_account_id_strict()
      and coalesce(active,false) and coalesce(can_login,false);
  if not found then raise exception 'active_staff_account_required' using errcode='42501'; end if;
  select * into v_staff from public.staff where staff.id=p_staff_id;
  if not found then raise exception 'staff_not_found' using errcode='22023'; end if;
  if v_actor.role not in ('general_manager','admin','executive_manager','branches_manager','branch_manager')
     or (v_actor.role='branch_manager' and trim(coalesce(v_actor.branch,''))<>trim(coalesce(v_staff.branch,''))) then
    raise exception 'not_authorized_for_hr_milestones' using errcode='42501';
  end if;
  return query
  select m.id,m.staff_id,m.kind,m.title,m.due_on,m.note,m.created_at,
    coalesce(creator.name,creator.username)::text,m.completed_at,
    coalesce(completer.name,completer.username)::text
  from public.hr_staff_milestones_v1 m
  left join public.staff_accounts creator on creator.id=m.created_by
  left join public.staff_accounts completer on completer.id=m.completed_by
  where m.staff_id=p_staff_id order by m.created_at desc,m.id desc
  limit least(greatest(coalesce(p_limit,100),1),200);
end $$;

create function public.hr_create_staff_milestone_v1(p_staff_id uuid,p_kind text,p_title text,p_due_on date default null,p_note text default null)
returns uuid language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_actor public.staff_accounts%rowtype; v_staff public.staff%rowtype; v_id uuid;
begin
  select * into v_actor from public.staff_accounts
    where staff_accounts.id=public.dawaa_current_staff_account_id_strict()
      and coalesce(active,false) and coalesce(can_login,false);
  if not found or v_actor.role not in ('general_manager','admin','executive_manager','branches_manager') then
    raise exception 'not_authorized_for_hr_milestones' using errcode='42501';
  end if;
  select * into v_staff from public.staff where staff.id=p_staff_id;
  if not found then raise exception 'staff_not_found' using errcode='22023'; end if;
  if p_kind not in ('onboarding','document','training','offboarding')
     or length(trim(coalesce(p_title,''))) not between 3 and 160
     or length(coalesce(p_note,''))>1000 then
    raise exception 'invalid_milestone' using errcode='22023';
  end if;
  insert into public.hr_staff_milestones_v1(staff_id,kind,title,due_on,note,created_by)
  values (p_staff_id,p_kind,trim(p_title),p_due_on,nullif(trim(p_note),''),v_actor.id)
  returning id into v_id;
  return v_id;
end $$;

create function public.hr_complete_staff_milestone_v1(p_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_actor public.staff_accounts%rowtype; v_staff_branch text;
begin
  select * into v_actor from public.staff_accounts
    where staff_accounts.id=public.dawaa_current_staff_account_id_strict()
      and coalesce(active,false) and coalesce(can_login,false);
  if not found or v_actor.role not in ('general_manager','admin','executive_manager','branches_manager','branch_manager') then
    raise exception 'not_authorized_for_hr_milestones' using errcode='42501';
  end if;
  select s.branch into v_staff_branch from public.hr_staff_milestones_v1 m
    join public.staff s on s.id=m.staff_id where m.id=p_id for update of m;
  if not found then raise exception 'milestone_not_found' using errcode='22023'; end if;
  if v_actor.role='branch_manager' and trim(coalesce(v_actor.branch,''))<>trim(coalesce(v_staff_branch,'')) then
    raise exception 'not_authorized_for_hr_milestones' using errcode='42501';
  end if;
  update public.hr_staff_milestones_v1 set completed_at=now(),completed_by=v_actor.id
    where id=p_id and completed_at is null;
  return found;
end $$;

revoke execute on function public.hr_list_staff_milestones_v1(uuid,integer) from public;
revoke execute on function public.hr_create_staff_milestone_v1(uuid,text,text,date,text) from public;
revoke execute on function public.hr_complete_staff_milestone_v1(uuid) from public;
grant execute on function public.hr_list_staff_milestones_v1(uuid,integer) to anon,authenticated,service_role;
grant execute on function public.hr_create_staff_milestone_v1(uuid,text,text,date,text) to anon,authenticated,service_role;
grant execute on function public.hr_complete_staff_milestone_v1(uuid) to anon,authenticated,service_role;

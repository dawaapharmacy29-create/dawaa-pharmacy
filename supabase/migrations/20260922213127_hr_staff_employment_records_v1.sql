-- Historical employment document metadata. It never changes current staff, accounts or payroll.
create table public.hr_staff_employment_records_v1 (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  record_kind text not null check (record_kind in ('contract','renewal','assignment','correction')),
  title text not null check (length(trim(title)) between 3 and 160),
  effective_from date not null,
  effective_to date,
  reference_code text check (length(coalesce(reference_code,''))<=100),
  note text check (length(coalesce(note,''))<=1000),
  supersedes_id uuid unique references public.hr_staff_employment_records_v1(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.staff_accounts(id),
  constraint employment_record_date_order check (effective_to is null or effective_to>=effective_from),
  constraint employment_record_correction_target check ((record_kind='correction') = (supersedes_id is not null))
);
create index hr_staff_employment_records_staff_idx
  on public.hr_staff_employment_records_v1(staff_id,effective_from desc,created_at desc);
alter table public.hr_staff_employment_records_v1 enable row level security;
revoke all on public.hr_staff_employment_records_v1 from public,anon,authenticated;

create function public.hr_list_staff_employment_records_v1(p_staff_id uuid,p_limit integer default 100)
returns table(id uuid,staff_id uuid,record_kind text,title text,effective_from date,effective_to date,
  reference_code text,note text,supersedes_id uuid,is_superseded boolean,created_at timestamptz,created_by_name text)
language plpgsql security definer set search_path=public,pg_catalog as $$
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
    raise exception 'not_authorized_for_employment_records' using errcode='42501';
  end if;
  return query
  select r.id,r.staff_id,r.record_kind,r.title,r.effective_from,r.effective_to,r.reference_code,r.note,
    r.supersedes_id,exists(select 1 from public.hr_staff_employment_records_v1 n where n.supersedes_id=r.id),
    r.created_at,coalesce(a.name,a.username)::text
  from public.hr_staff_employment_records_v1 r
  left join public.staff_accounts a on a.id=r.created_by
  where r.staff_id=p_staff_id
  order by r.effective_from desc,r.created_at desc,r.id desc
  limit least(greatest(coalesce(p_limit,100),1),200);
end $$;

create function public.hr_create_staff_employment_record_v1(
  p_staff_id uuid,p_record_kind text,p_title text,p_effective_from date,
  p_effective_to date default null,p_reference_code text default null,p_note text default null,p_supersedes_id uuid default null
)
returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_actor public.staff_accounts%rowtype; v_prior public.hr_staff_employment_records_v1%rowtype; v_id uuid;
begin
  select * into v_actor from public.staff_accounts
  where staff_accounts.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false) and coalesce(can_login,false);
  if not found or v_actor.role not in ('general_manager','admin','executive_manager','branches_manager') then
    raise exception 'not_authorized_for_employment_records' using errcode='42501';
  end if;
  if not exists(select 1 from public.staff where id=p_staff_id) then
    raise exception 'staff_not_found' using errcode='22023';
  end if;
  if p_record_kind not in ('contract','renewal','assignment','correction')
     or length(trim(coalesce(p_title,''))) not between 3 and 160
     or p_effective_from is null or (p_effective_to is not null and p_effective_to<p_effective_from)
     or length(coalesce(p_reference_code,''))>100 or length(coalesce(p_note,''))>1000
     or ((p_record_kind='correction') is distinct from (p_supersedes_id is not null)) then
    raise exception 'invalid_employment_record' using errcode='22023';
  end if;
  if p_supersedes_id is not null then
    select * into v_prior from public.hr_staff_employment_records_v1 where id=p_supersedes_id for update;
    if not found or v_prior.staff_id<>p_staff_id
       or exists(select 1 from public.hr_staff_employment_records_v1 where supersedes_id=p_supersedes_id) then
      raise exception 'invalid_correction_target' using errcode='22023';
    end if;
  end if;
  insert into public.hr_staff_employment_records_v1(
    staff_id,record_kind,title,effective_from,effective_to,reference_code,note,supersedes_id,created_by
  ) values (
    p_staff_id,p_record_kind,trim(p_title),p_effective_from,p_effective_to,
    nullif(trim(p_reference_code),''),nullif(trim(p_note),''),p_supersedes_id,v_actor.id
  ) returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.hr_list_staff_employment_records_v1(uuid,integer) from public;
revoke execute on function public.hr_create_staff_employment_record_v1(uuid,text,text,date,date,text,text,uuid) from public;
grant execute on function public.hr_list_staff_employment_records_v1(uuid,integer) to anon,authenticated,service_role;
grant execute on function public.hr_create_staff_employment_record_v1(uuid,text,text,date,date,text,text,uuid) to anon,authenticated,service_role;

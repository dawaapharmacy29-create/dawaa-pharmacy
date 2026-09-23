-- Effective-dated HR metadata. Canonical identity remains staff; this table never drives payroll.
create table public.hr_employment_profile_versions_v1 (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  effective_from date not null,
  employment_type text not null check (employment_type in ('full_time','part_time','temporary','contractor')),
  grade_label text check (length(coalesce(grade_label,'')) <= 100),
  reports_to_staff_id uuid references public.staff(id) on delete restrict,
  change_reason text check (length(coalesce(change_reason,'')) <= 500),
  supersedes_id uuid unique references public.hr_employment_profile_versions_v1(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.staff_accounts(id),
  constraint hr_profile_not_self_manager check (reports_to_staff_id is distinct from staff_id)
);
create unique index hr_profile_initial_date_unique_v1
  on public.hr_employment_profile_versions_v1(staff_id,effective_from) where supersedes_id is null;
create index hr_profile_history_idx_v1
  on public.hr_employment_profile_versions_v1(staff_id,effective_from desc,created_at desc);
alter table public.hr_employment_profile_versions_v1 enable row level security;
revoke all on public.hr_employment_profile_versions_v1 from public,anon,authenticated;

create function public.hr_get_employment_profile_timeline_v1(p_staff_id uuid,p_as_of date default null)
returns jsonb language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_actor public.staff_accounts%rowtype; v_staff public.staff%rowtype;
  v_current jsonb; v_history jsonb;
begin
  select * into v_actor from public.staff_accounts
  where staff_accounts.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false) and coalesce(can_login,false);
  if not found then raise exception 'active_staff_account_required' using errcode='42501'; end if;
  select * into v_staff from public.staff where staff.id=p_staff_id;
  if not found then raise exception 'staff_not_found' using errcode='22023'; end if;
  if v_actor.role not in ('general_manager','admin','executive_manager','branches_manager','branch_manager')
    or (v_actor.role='branch_manager' and trim(coalesce(v_actor.branch,''))<>trim(coalesce(v_staff.branch,''))) then
    raise exception 'not_authorized_for_hr_profile' using errcode='42501';
  end if;

  with versions as (
    select p.id,p.staff_id,p.effective_from,p.employment_type,p.grade_label,
      p.reports_to_staff_id,manager.name manager_name,p.change_reason,p.supersedes_id,
      p.created_at,coalesce(actor.name,actor.username) created_by_name,
      exists(select 1 from public.hr_employment_profile_versions_v1 successor where successor.supersedes_id=p.id) is_superseded
    from public.hr_employment_profile_versions_v1 p
    left join public.staff manager on manager.id=p.reports_to_staff_id
    left join public.staff_accounts actor on actor.id=p.created_by
    where p.staff_id=p_staff_id
  )
  select to_jsonb(v) into v_current from versions v
  where not v.is_superseded and v.effective_from<=coalesce(p_as_of,(now() at time zone 'Africa/Cairo')::date)
  order by v.effective_from desc,v.created_at desc,v.id desc limit 1;

  select coalesce(jsonb_agg(to_jsonb(history_row) order by history_row.effective_from desc,
    history_row.created_at desc,history_row.id desc),'[]'::jsonb) into v_history
  from (
    select p.id,p.staff_id,p.effective_from,p.employment_type,p.grade_label,
      p.reports_to_staff_id,manager.name manager_name,p.change_reason,p.supersedes_id,
      p.created_at,coalesce(actor.name,actor.username) created_by_name,
      exists(select 1 from public.hr_employment_profile_versions_v1 successor where successor.supersedes_id=p.id) is_superseded
    from public.hr_employment_profile_versions_v1 p
    left join public.staff manager on manager.id=p.reports_to_staff_id
    left join public.staff_accounts actor on actor.id=p.created_by
    where p.staff_id=p_staff_id
    order by p.effective_from desc,p.created_at desc,p.id desc limit 100
  ) history_row;
  return jsonb_build_object('current',v_current,'history',v_history,'as_of',coalesce(p_as_of,(now() at time zone 'Africa/Cairo')::date));
end $$;

create function public.hr_create_employment_profile_version_v1(
  p_staff_id uuid,p_effective_from date,p_employment_type text,p_grade_label text default null,
  p_reports_to_staff_id uuid default null,p_change_reason text default null,p_supersedes_id uuid default null
)
returns uuid language plpgsql security definer set search_path=public,pg_catalog as $$
declare v_actor public.staff_accounts%rowtype; v_prior public.hr_employment_profile_versions_v1%rowtype; v_id uuid;
begin
  select * into v_actor from public.staff_accounts
  where staff_accounts.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(active,false) and coalesce(can_login,false);
  if not found or v_actor.role not in ('general_manager','admin','executive_manager','branches_manager') then
    raise exception 'not_authorized_for_hr_profile' using errcode='42501';
  end if;
  if not exists(select 1 from public.staff where id=p_staff_id) then
    raise exception 'staff_not_found' using errcode='22023'; end if;
  if p_effective_from is null or p_employment_type not in ('full_time','part_time','temporary','contractor')
    or length(coalesce(p_grade_label,''))>100 or length(coalesce(p_change_reason,''))>500
    or p_reports_to_staff_id=p_staff_id then
    raise exception 'invalid_hr_profile' using errcode='22023';
  end if;
  if p_supersedes_id is not null then
    select * into v_prior from public.hr_employment_profile_versions_v1 where id=p_supersedes_id for update;
    if not found or v_prior.staff_id<>p_staff_id or v_prior.effective_from<>p_effective_from
      or nullif(trim(coalesce(p_change_reason,'')),'') is null
      or exists(select 1 from public.hr_employment_profile_versions_v1 where supersedes_id=p_supersedes_id) then
      raise exception 'invalid_hr_profile_correction' using errcode='22023';
    end if;
  end if;
  insert into public.hr_employment_profile_versions_v1(
    staff_id,effective_from,employment_type,grade_label,reports_to_staff_id,change_reason,supersedes_id,created_by
  ) values (
    p_staff_id,p_effective_from,p_employment_type,nullif(trim(p_grade_label),''),p_reports_to_staff_id,
    nullif(trim(p_change_reason),''),p_supersedes_id,v_actor.id
  ) returning id into v_id;
  return v_id;
end $$;

revoke execute on function public.hr_get_employment_profile_timeline_v1(uuid,date) from public;
revoke execute on function public.hr_create_employment_profile_version_v1(uuid,date,text,text,uuid,text,uuid) from public;
grant execute on function public.hr_get_employment_profile_timeline_v1(uuid,date) to anon,authenticated,service_role;
grant execute on function public.hr_create_employment_profile_version_v1(uuid,date,text,text,uuid,text,uuid) to anon,authenticated,service_role;

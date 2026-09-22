-- Shared action inbox for due and overdue employee lifecycle tasks.
create index hr_staff_milestones_due_open_idx
  on public.hr_staff_milestones_v1(due_on,staff_id)
  where completed_at is null and due_on is not null;

create function public.hr_list_due_staff_milestones_v1(p_branch text default null,p_limit integer default 100)
returns table(id uuid,staff_id uuid,staff_name text,branch text,kind text,title text,
  due_on date,note text,created_at timestamptz,days_until_due integer)
language plpgsql security definer set search_path = public, pg_catalog as $$
declare v_actor public.staff_accounts%rowtype;
  v_branch text;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
begin
  select * into v_actor from public.staff_accounts
    where staff_accounts.id=public.dawaa_current_staff_account_id_strict()
      and coalesce(active,false) and coalesce(can_login,false);
  if not found or v_actor.role not in ('general_manager','admin','executive_manager','branches_manager','branch_manager') then
    raise exception 'not_authorized_for_hr_milestones' using errcode='42501';
  end if;
  if v_actor.role='branch_manager' then
    v_branch:=trim(coalesce(v_actor.branch,''));
    if v_branch='' or (nullif(trim(coalesce(p_branch,'')),'') is not null and trim(p_branch)<>v_branch) then
      raise exception 'not_authorized_for_branch' using errcode='42501';
    end if;
  else
    v_branch:=nullif(trim(coalesce(p_branch,'')),'');
  end if;

  return query
  select m.id,m.staff_id,s.name::text,s.branch::text,m.kind,m.title,m.due_on,m.note,m.created_at,
    (m.due_on-v_today)::integer
  from public.hr_staff_milestones_v1 m
  join public.staff s on s.id=m.staff_id
  where m.completed_at is null and m.due_on is not null and m.due_on<=v_today+7
    and (v_branch is null or trim(s.branch)=v_branch)
  order by m.due_on,m.created_at,m.id
  limit least(greatest(coalesce(p_limit,100),1),200);
end $$;

revoke execute on function public.hr_list_due_staff_milestones_v1(text,integer) from public;
grant execute on function public.hr_list_due_staff_milestones_v1(text,integer) to anon,authenticated,service_role;

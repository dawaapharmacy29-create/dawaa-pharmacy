create or replace function public.dawaa_build_attendance_day_resolution_v1(
  p_staff_id uuid,
  p_attendance_date date
)
returns jsonb
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
  select public.dawaa_build_attendance_day_resolution_v2(p_staff_id,p_attendance_date)
         || jsonb_build_object('legacy_entrypoint',true,'resolution_version',2);
$$;

create or replace function public.get_shift_schedule_identity_health_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype;
  v_total integer:=0; v_linked integer:=0; v_unlinked integer:=0;
  v_same_branch_exact integer:=0; v_groups integer:=0;
begin
  select * into v_actor from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true;
  if not found then raise exception 'active staff actor required' using errcode='42501'; end if;

  select count(*),count(*) filter(where staff_id is not null),count(*) filter(where staff_id is null)
    into v_total,v_linked,v_unlinked
  from public.shift_schedules
  where effective_to is null;

  select count(*) into v_same_branch_exact
  from public.shift_schedules ss
  where ss.effective_to is null and ss.staff_id is null
    and exists(
      select 1 from public.staff s
      where coalesce(s.active,false)=true
        and trim(coalesce(s.name,''))=trim(coalesce(ss.staff_name,ss.employee_name,''))
        and coalesce(s.branch,'')=coalesce(ss.branch,'')
    );

  select count(*) into v_groups from (
    select trim(coalesce(ss.staff_name,ss.employee_name,'')) n,coalesce(ss.branch,'') b
    from public.shift_schedules ss
    where ss.effective_to is null and ss.staff_id is null
    group by 1,2
  ) q;

  return jsonb_build_object(
    'total_rows',v_total,'linked_rows',v_linked,'unlinked_rows',v_unlinked,
    'unlinked_groups',v_groups,'same_branch_exact_candidate_rows',v_same_branch_exact,
    'checked_at',now()
  );
end;
$$;

create or replace function public.list_unmapped_shift_schedule_groups_v1(
  p_search text default null,
  p_limit integer default 200
)
returns table(
  legacy_staff_name text,legacy_branch text,schedule_rows bigint,
  first_created_at timestamptz,last_updated_at timestamptz,days text[],
  exact_same_branch_candidate_id uuid,exact_same_branch_candidate_name text
)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $$
declare v_actor public.staff_accounts%rowtype;
begin
  select * into v_actor from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true;
  if not found then raise exception 'active staff actor required' using errcode='42501'; end if;

  return query
  with grouped as (
    select
      trim(coalesce(ss.staff_name,ss.employee_name,'')) as n,
      coalesce(ss.branch,'') as b,
      count(*) as c,
      min(ss.created_at) as first_at,
      max(coalesce(ss.updated_at,ss.created_at)) as last_at,
      array_agg(distinct coalesce(nullif(trim(ss.day_name),''),coalesce(ss.shift_date,ss.date)::text)
        order by coalesce(nullif(trim(ss.day_name),''),coalesce(ss.shift_date,ss.date)::text)) as d
    from public.shift_schedules ss
    where ss.effective_to is null and ss.staff_id is null
      and (p_search is null or trim(p_search)=''
        or coalesce(ss.staff_name,ss.employee_name,'') ilike '%'||trim(p_search)||'%'
        or coalesce(ss.branch,'') ilike '%'||trim(p_search)||'%')
    group by 1,2
  )
  select g.n,g.b,g.c,g.first_at,g.last_at,g.d,c.id,c.name
  from grouped g
  left join lateral (
    select s.id,s.name from public.staff s
    where coalesce(s.active,false)=true
      and trim(coalesce(s.name,''))=g.n and coalesce(s.branch,'')=g.b
    order by s.updated_at desc nulls last,s.created_at desc nulls last,s.id limit 1
  ) c on true
  order by g.c desc,g.b,g.n
  limit greatest(1,least(coalesce(p_limit,200),500));
end;
$$;

create or replace function public.assign_shift_schedule_staff_identity_v1(
  p_legacy_staff_name text,p_legacy_branch text,p_staff_id uuid,p_note text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $$
declare
  v_actor public.staff_accounts%rowtype; v_staff public.staff%rowtype;
  v_rows integer:=0; v_note text:=nullif(trim(coalesce(p_note,'')),'');
begin
  select * into v_actor from public.staff_accounts sa
  where sa.id=public.dawaa_current_staff_account_id_strict()
    and coalesce(sa.active,false)=true and coalesce(sa.can_login,false)=true;
  if not found or not public.dawaa_actor_is_top_management_v1() then
    raise exception 'not_authorized_for_schedule_identity_mapping' using errcode='42501';
  end if;
  if v_note is null then raise exception 'schedule_identity_mapping_requires_note' using errcode='22023'; end if;

  select * into v_staff from public.staff s where s.id=p_staff_id and coalesce(s.active,false)=true;
  if not found then raise exception 'target_staff_not_found_or_inactive' using errcode='22023'; end if;
  if coalesce(v_staff.branch,'') is distinct from coalesce(p_legacy_branch,'') then
    raise exception 'schedule_identity_cross_branch_mapping_blocked' using errcode='22023';
  end if;

  update public.shift_schedules ss
  set staff_id=v_staff.id,
      employee_name=coalesce(nullif(trim(ss.employee_name),''),v_staff.name),
      role=coalesce(nullif(trim(ss.role),''),v_staff.role),
      updated_at=now()
  where ss.effective_to is null and ss.staff_id is null
    and trim(coalesce(ss.staff_name,ss.employee_name,''))=trim(coalesce(p_legacy_staff_name,''))
    and coalesce(ss.branch,'')=coalesce(p_legacy_branch,'');
  get diagnostics v_rows=row_count;

  if v_rows=0 then raise exception 'no_unmapped_schedule_rows_found' using errcode='22023'; end if;

  insert into public.shift_schedule_identity_audit(
    staff_id,canonical_staff_name,legacy_staff_name,legacy_branch,rows_updated,
    actor_id,actor_name,actor_role,note
  ) values(
    v_staff.id,v_staff.name,trim(p_legacy_staff_name),coalesce(p_legacy_branch,''),v_rows,
    v_actor.id::text,coalesce(v_actor.name,v_actor.staff_name,v_actor.username),v_actor.role,v_note
  );

  return jsonb_build_object('success',true,'staff_id',v_staff.id,'staff_name',v_staff.name,'branch',v_staff.branch,'rows_updated',v_rows);
end;
$$;

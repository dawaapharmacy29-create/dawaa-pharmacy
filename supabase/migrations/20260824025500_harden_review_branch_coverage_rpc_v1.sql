-- Harden the doctor branch-coverage helpers used by Reviews.
--
-- The app authenticates staff through a custom staff-account identity carried on
-- the request. These RPCs are SECURITY DEFINER, so every read/write must resolve
-- that canonical actor and enforce permissions + branch scope inside PostgreSQL.

create or replace function public.dawaa_review_coverage_branch_key_v1(p_branch text)
returns text
language sql
immutable
as $$
  select case
    when lower(trim(coalesce(p_branch,''))) like '%شكري%' then 'shokry'
    when lower(trim(coalesce(p_branch,''))) like '%شكرى%' then 'shokry'
    when lower(trim(coalesce(p_branch,''))) like '%شامي%' then 'elshamy'
    else lower(trim(coalesce(p_branch,'')))
  end
$$;

create or replace function public.dawaa_can_access_review_coverage_branch_v1(
  p_actor_id uuid,
  p_branch text,
  p_write boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_role text;
  v_actor_branch text;
  v_required_permission text := case when p_write then 'approve_reviews' else 'view_reviews' end;
begin
  if p_actor_id is null then return false; end if;

  select sa.role, sa.branch
    into v_role, v_actor_branch
  from public.staff_accounts sa
  where sa.id = p_actor_id
    and coalesce(sa.active,false)
    and coalesce(sa.can_login,false)
  limit 1;

  if v_role is null then return false; end if;
  if not public.user_has_permission(p_actor_id, v_required_permission) then return false; end if;

  if v_role in ('general_manager','executive_manager','branches_manager')
     and public.dawaa_review_coverage_branch_key_v1(v_actor_branch) in ('كل الفروع','all','all branches') then
    return true;
  end if;

  return public.dawaa_review_coverage_branch_key_v1(v_actor_branch)
       = public.dawaa_review_coverage_branch_key_v1(p_branch);
end;
$$;

create or replace function public.add_branch_coverage(
  p_staff_id uuid,
  p_staff_name text,
  p_role text,
  p_home_branch text,
  p_covering_branch text,
  p_start_date date,
  p_end_date date,
  p_notes text,
  p_created_by_name text
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_id uuid;
  v_actor_id uuid;
  v_actor_name text;
  v_staff_name text;
  v_staff_role text;
  v_home_branch text;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if not public.dawaa_can_access_review_coverage_branch_v1(v_actor_id, p_covering_branch, true) then
    raise exception using errcode = '42501', message = 'Not authorized to manage review coverage for this branch';
  end if;

  select sa.name into v_actor_name
  from public.staff_accounts sa
  where sa.id = v_actor_id;

  select s.name, s.role, s.branch
    into v_staff_name, v_staff_role, v_home_branch
  from public.staff s
  where s.id = p_staff_id
    and coalesce(s.active,true)
  limit 1;

  if v_staff_name is null then
    raise exception using errcode = '22023', message = 'Coverage staff member is missing or inactive';
  end if;

  if public.dawaa_review_coverage_branch_key_v1(v_home_branch)
     = public.dawaa_review_coverage_branch_key_v1(p_covering_branch) then
    raise exception using errcode = '22023', message = 'Coverage must represent a different home branch';
  end if;

  if p_end_date is not null and p_end_date < p_start_date then
    raise exception using errcode = '22023', message = 'Coverage end date cannot be before start date';
  end if;

  insert into public.staff_branch_coverage (
    staff_id, staff_name, role, home_branch, covering_branch,
    start_date, end_date, notes, created_by_name
  ) values (
    p_staff_id, v_staff_name, v_staff_role, v_home_branch, p_covering_branch,
    p_start_date, p_end_date, nullif(trim(p_notes),''), v_actor_name
  )
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.end_branch_coverage(p_id uuid, p_ended_by_name text)
returns void
language plpgsql
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_actor_id uuid;
  v_actor_name text;
  v_covering_branch text;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();

  select c.covering_branch into v_covering_branch
  from public.staff_branch_coverage c
  where c.id = p_id
  limit 1;

  if v_covering_branch is null then
    raise exception using errcode = '22023', message = 'Coverage record not found';
  end if;

  if not public.dawaa_can_access_review_coverage_branch_v1(v_actor_id, v_covering_branch, true) then
    raise exception using errcode = '42501', message = 'Not authorized to end review coverage for this branch';
  end if;

  select sa.name into v_actor_name
  from public.staff_accounts sa
  where sa.id = v_actor_id;

  update public.staff_branch_coverage
  set active = false,
      ended_at = now(),
      ended_by_name = v_actor_name
  where id = p_id;
end;
$$;

create or replace function public.list_branch_coverage(p_branch text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_actor_id uuid;
  v_result jsonb;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if not public.dawaa_can_access_review_coverage_branch_v1(v_actor_id, p_branch, false) then
    raise exception using errcode = '42501', message = 'Not authorized to view review coverage for this branch';
  end if;

  select coalesce(jsonb_agg(row_to_json(t) order by t.start_date desc), '[]'::jsonb)
    into v_result
  from (
    select id, staff_name, role, home_branch, covering_branch, start_date,
           end_date, active, notes, created_by_name, created_at
    from public.staff_branch_coverage
    where public.dawaa_review_coverage_branch_key_v1(covering_branch)
            = public.dawaa_review_coverage_branch_key_v1(p_branch)
       or public.dawaa_review_coverage_branch_key_v1(home_branch)
            = public.dawaa_review_coverage_branch_key_v1(p_branch)
    order by start_date desc
    limit 50
  ) t;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

create or replace function public.get_active_coverage_doctors(p_branch text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth, pg_catalog
as $$
declare
  v_actor_id uuid;
  v_result jsonb;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if not public.dawaa_can_access_review_coverage_branch_v1(v_actor_id, p_branch, false) then
    raise exception using errcode = '42501', message = 'Not authorized to view active review coverage for this branch';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', staff_id,
    'name', staff_name,
    'role', coalesce(role,'pharmacist'),
    'branch', covering_branch || ' (تغطية من ' || home_branch || ')',
    'coverage_id', id
  )), '[]'::jsonb)
    into v_result
  from public.staff_branch_coverage
  where public.dawaa_review_coverage_branch_key_v1(covering_branch)
          = public.dawaa_review_coverage_branch_key_v1(p_branch)
    and active = true
    and start_date <= current_date
    and (end_date is null or end_date >= current_date);

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

-- The app's custom staff identity arrives through the anon/authenticated client
-- roles. Keep RPC execution available there, but only after the functions above
-- enforce canonical actor, permission, and branch scope internally.
revoke all on function public.add_branch_coverage(uuid,text,text,text,text,date,date,text,text)
  from public, anon, authenticated;
revoke all on function public.end_branch_coverage(uuid,text)
  from public, anon, authenticated;
revoke all on function public.list_branch_coverage(text)
  from public, anon, authenticated;
revoke all on function public.get_active_coverage_doctors(text)
  from public, anon, authenticated;

grant execute on function public.add_branch_coverage(uuid,text,text,text,text,date,date,text,text)
  to anon, authenticated, service_role;
grant execute on function public.end_branch_coverage(uuid,text)
  to anon, authenticated, service_role;
grant execute on function public.list_branch_coverage(text)
  to anon, authenticated, service_role;
grant execute on function public.get_active_coverage_doctors(text)
  to anon, authenticated, service_role;

revoke all on function public.dawaa_can_access_review_coverage_branch_v1(uuid,text,boolean)
  from public, anon, authenticated;
revoke all on function public.dawaa_review_coverage_branch_key_v1(text)
  from public, anon, authenticated;
grant execute on function public.dawaa_can_access_review_coverage_branch_v1(uuid,text,boolean)
  to service_role;
grant execute on function public.dawaa_review_coverage_branch_key_v1(text)
  to service_role;

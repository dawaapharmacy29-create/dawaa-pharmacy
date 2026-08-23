-- Harden the active branch-inspection workflow so UI access and database writes
-- cannot drift apart. Production was migrated first and verified before this file
-- was committed to the repository.

create or replace function public.dawaa_can_branch_inspection(p_manage boolean default false)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account_id uuid;
  v_role text;
  v_permissions jsonb := '{}'::jsonb;
  v_view_override boolean;
  v_manage_override boolean;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then
    return false;
  end if;

  select lower(trim(coalesce(role, ''))), coalesce(permissions, '{}'::jsonb)
  into v_role, v_permissions
  from public.staff_accounts
  where id = v_account_id
    and coalesce(active, false)
    and coalesce(can_login, false)
  limit 1;

  -- The application role contract exposes branch inspection only to senior
  -- management / branches management. Branch managers do not own this route.
  if v_role not in ('general_manager', 'executive_manager', 'branches_manager', 'admin') then
    return false;
  end if;

  -- Explicit per-account false values remain hard restrictions.
  if v_permissions ? 'view_branch_inspection' then
    v_view_override := nullif(v_permissions->>'view_branch_inspection', '')::boolean;
    if v_view_override is false then
      return false;
    end if;
  end if;

  if exists (
    select 1
    from public.staff_permission_overrides o
    where o.staff_account_id = v_account_id
      and o.permission_key = 'view_branch_inspection'
      and o.allowed is false
  ) then
    return false;
  end if;

  if p_manage then
    if v_permissions ? 'manage_branch_inspection' then
      v_manage_override := nullif(v_permissions->>'manage_branch_inspection', '')::boolean;
      if v_manage_override is false then
        return false;
      end if;
    end if;

    if exists (
      select 1
      from public.staff_permission_overrides o
      where o.staff_account_id = v_account_id
        and o.permission_key = 'manage_branch_inspection'
        and o.allowed is false
    ) then
      return false;
    end if;
  end if;

  return true;
end;
$$;

grant execute on function public.dawaa_can_branch_inspection(boolean) to anon, authenticated;

-- Remove the legacy unconditional policies.
drop policy if exists branch_inspections_insert_app on public.branch_inspections;
drop policy if exists branch_inspections_select_app on public.branch_inspections;
drop policy if exists branch_inspections_update_app on public.branch_inspections;
drop policy if exists branch_inspections_insert_canonical on public.branch_inspections;
drop policy if exists branch_inspections_select_canonical on public.branch_inspections;
drop policy if exists branch_inspections_update_canonical on public.branch_inspections;

create policy branch_inspections_select_canonical
on public.branch_inspections
for select
to anon, authenticated
using (public.dawaa_can_branch_inspection(false));

create policy branch_inspections_insert_canonical
on public.branch_inspections
for insert
to anon, authenticated
with check (public.dawaa_can_branch_inspection(true));

create policy branch_inspections_update_canonical
on public.branch_inspections
for update
to anon, authenticated
using (public.dawaa_can_branch_inspection(true))
with check (public.dawaa_can_branch_inspection(true));

drop policy if exists branch_visit_staff_reviews_insert_app on public.branch_visit_staff_reviews;
drop policy if exists branch_visit_staff_reviews_select_app on public.branch_visit_staff_reviews;
drop policy if exists branch_visit_staff_reviews_update_app on public.branch_visit_staff_reviews;
drop policy if exists branch_visit_staff_reviews_insert_canonical on public.branch_visit_staff_reviews;
drop policy if exists branch_visit_staff_reviews_select_canonical on public.branch_visit_staff_reviews;
drop policy if exists branch_visit_staff_reviews_update_canonical on public.branch_visit_staff_reviews;

create policy branch_visit_staff_reviews_select_canonical
on public.branch_visit_staff_reviews
for select
to anon, authenticated
using (public.dawaa_can_branch_inspection(false));

create policy branch_visit_staff_reviews_insert_canonical
on public.branch_visit_staff_reviews
for insert
to anon, authenticated
with check (public.dawaa_can_branch_inspection(true));

create policy branch_visit_staff_reviews_update_canonical
on public.branch_visit_staff_reviews
for update
to anon, authenticated
using (public.dawaa_can_branch_inspection(true))
with check (public.dawaa_can_branch_inspection(true));

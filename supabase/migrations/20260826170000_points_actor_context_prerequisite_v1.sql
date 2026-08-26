-- Guarded actor context prerequisite for Points Architecture V3.
-- Restores only the identity helpers required by the V3 read/write models.

create or replace function public.employee_operating_actor_id()
returns text
language sql
stable
set search_path = public, pg_catalog
as $$
  select coalesce(
    nullif((nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-dawaa-user-id'), ''),
    nullif(current_setting('request.jwt.claim.sub', true), '')
  );
$$;

create or replace function public.employee_operating_actor_role()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select lower(trim(coalesce(sa.role, '')))
  from public.staff_accounts sa
  where sa.id::text = public.employee_operating_actor_id()
    and coalesce(sa.active, true) = true
    and coalesce(sa.can_login, true) = true
  limit 1;
$$;

create or replace function public.employee_operating_actor_branch()
returns text
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select nullif(trim(coalesce(sa.branch, '')), '')
  from public.staff_accounts sa
  where sa.id::text = public.employee_operating_actor_id()
    and coalesce(sa.active, true) = true
    and coalesce(sa.can_login, true) = true
  limit 1;
$$;

create or replace function public.employee_operating_can_manage()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select coalesce(public.employee_operating_actor_role(), '') = any(
    array['general_manager','admin','executive_manager','branches_manager','branch_manager','customer_service_manager']
  );
$$;

revoke all on function public.employee_operating_actor_id() from public;
revoke all on function public.employee_operating_actor_role() from public;
revoke all on function public.employee_operating_actor_branch() from public;
revoke all on function public.employee_operating_can_manage() from public;

grant execute on function public.employee_operating_actor_id() to anon, authenticated;
grant execute on function public.employee_operating_actor_role() to anon, authenticated;
grant execute on function public.employee_operating_actor_branch() to anon, authenticated;
grant execute on function public.employee_operating_can_manage() to anon, authenticated;

comment on function public.employee_operating_actor_role() is
  'Server-derived active staff role used by guarded employee/points RPCs. Never trusts role hints from the client.';
comment on function public.employee_operating_actor_branch() is
  'Server-derived active staff branch used by guarded employee/points RPCs. Never trusts branch hints from the client.';

-- Harden staff_accounts without deleting historical rows.
-- This migration is intentionally idempotent and keeps custom login RPC working.

begin;

-- Resolve the current Dawaa account from the request header used by the app.
create or replace function public.dawaa_current_staff_account_id_strict()
returns uuid
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select nullif(
    coalesce(
      nullif(current_setting('app.current_user_id', true), ''),
      nullif((nullif(current_setting('request.headers', true), '')::json ->> 'x-dawaa-user-id'), ''),
      nullif(current_setting('request.jwt.claim.sub', true), '')
    ),
    ''
  )::uuid
$$;

create or replace function public.dawaa_can_view_staff_accounts_strict()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.staff_accounts a
    where a.id = public.dawaa_current_staff_account_id_strict()
      and coalesce(a.active, false) = true
      and coalesce(a.can_login, false) = true
      and (
        lower(coalesce(a.role, '')) in (
          'admin','general_manager','executive_manager','branches_manager','branch_manager',
          'مدير عام','المدير العام','مدير الفروع','مدير فرع'
        )
        or coalesce((a.permissions ->> 'view_staff_accounts')::boolean, false)
        or coalesce((a.permissions ->> 'manage_staff_accounts')::boolean, false)
      )
  )
$$;

create or replace function public.dawaa_can_manage_staff_accounts_strict()
returns boolean
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select exists (
    select 1
    from public.staff_accounts a
    where a.id = public.dawaa_current_staff_account_id_strict()
      and coalesce(a.active, false) = true
      and coalesce(a.can_login, false) = true
      and (
        lower(coalesce(a.role, '')) in (
          'admin','general_manager','executive_manager','branches_manager',
          'مدير عام','المدير العام','مدير الفروع'
        )
        or coalesce((a.permissions ->> 'manage_staff_accounts')::boolean, false)
      )
  )
$$;

-- An active login account must always be linked to a canonical staff identity.
create or replace function public.enforce_active_staff_account_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if coalesce(new.active, false) = true
     and coalesce(new.can_login, false) = true
     and nullif(trim(new.staff_id::text), '') is null then
    raise exception 'Active login accounts must be linked to staff_id'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_active_staff_account_identity on public.staff_accounts;
create trigger trg_enforce_active_staff_account_identity
before insert or update of active, can_login, staff_id
on public.staff_accounts
for each row
execute function public.enforce_active_staff_account_identity();

-- Exact resolver only. Managers no longer receive every account for any search term.
create or replace function public.resolve_staff_account_safe(p_identifier text)
returns table (
  id uuid,
  staff_id text,
  username text,
  name text,
  staff_name text,
  role text,
  branch text,
  active boolean,
  can_login boolean
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  with input as (
    select trim(coalesce(p_identifier, '')) as value
  )
  select
    a.id,
    a.staff_id::text,
    a.username,
    a.name,
    a.staff_name,
    a.role,
    a.branch,
    a.active,
    a.can_login
  from public.staff_accounts a, input i
  where i.value <> ''
    and coalesce(a.active, false) = true
    and coalesce(a.can_login, false) = true
    and (
      a.id::text = i.value
      or a.staff_id::text = i.value
      or lower(trim(coalesce(a.username, ''))) = lower(i.value)
      or lower(trim(coalesce(a.name, ''))) = lower(i.value)
      or lower(trim(coalesce(a.staff_name, ''))) = lower(i.value)
    )
  order by
    case
      when a.id::text = (select value from input) then 1
      when a.staff_id::text = (select value from input) then 2
      when lower(trim(coalesce(a.username, ''))) = lower((select value from input)) then 3
      else 4
    end,
    coalesce(a.updated_at, a.created_at) desc nulls last
  limit 20
$$;

create or replace function public.list_staff_accounts_safe()
returns table (
  id uuid,
  staff_id text,
  username text,
  password_status text,
  name text,
  staff_name text,
  role text,
  branch text,
  active boolean,
  can_login boolean,
  visible_in_admin boolean,
  permissions jsonb,
  last_login_at timestamptz,
  updated_at timestamptz,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select
    a.id,
    a.staff_id::text,
    a.username,
    a.password_status,
    a.name,
    a.staff_name,
    a.role,
    a.branch,
    a.active,
    a.can_login,
    a.visible_in_admin,
    coalesce(a.permissions, '{}'::jsonb),
    a.last_login_at,
    a.updated_at,
    a.created_at
  from public.staff_accounts a
  where public.dawaa_can_view_staff_accounts_strict()
    and coalesce(a.visible_in_admin, true) = true
  order by coalesce(a.name, a.staff_name, a.username)
$$;

create or replace function public.count_staff_accounts_without_staff_safe()
returns integer
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select case
    when public.dawaa_can_view_staff_accounts_strict()
      then (
        select count(*)::integer
        from public.staff_accounts
        where staff_id is null
          and coalesce(visible_in_admin, true) = true
      )
    else null
  end
$$;

-- Remove every known permissive or duplicated legacy policy.
do $$
declare
  p record;
begin
  for p in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'staff_accounts'
  loop
    execute format('drop policy if exists %I on public.staff_accounts', p.policyname);
  end loop;
end $$;

alter table public.staff_accounts enable row level security;

create policy staff_accounts_read_strict
on public.staff_accounts
for select
to anon, authenticated
using (
  id = public.dawaa_current_staff_account_id_strict()
  or public.dawaa_can_view_staff_accounts_strict()
);

create policy staff_accounts_insert_strict
on public.staff_accounts
for insert
to anon, authenticated
with check (public.dawaa_can_manage_staff_accounts_strict());

create policy staff_accounts_update_strict
on public.staff_accounts
for update
to anon, authenticated
using (public.dawaa_can_manage_staff_accounts_strict())
with check (public.dawaa_can_manage_staff_accounts_strict());

create policy staff_accounts_delete_strict
on public.staff_accounts
for delete
to anon, authenticated
using (public.dawaa_can_manage_staff_accounts_strict());

-- Preserve direct app access, but RLS now decides which rows/actions are allowed.
grant select, insert, update, delete on public.staff_accounts to anon, authenticated;
grant execute on function public.resolve_staff_account_safe(text) to anon, authenticated;
grant execute on function public.list_staff_accounts_safe() to anon, authenticated;
grant execute on function public.count_staff_accounts_without_staff_safe() to anon, authenticated;

-- Hide disabled unlinked legacy accounts from normal admin lists; no row is deleted.
update public.staff_accounts
set visible_in_admin = false,
    updated_at = now()
where coalesce(active, false) = false
  and coalesce(can_login, false) = false
  and staff_id is null
  and coalesce(visible_in_admin, true) = true;

commit;

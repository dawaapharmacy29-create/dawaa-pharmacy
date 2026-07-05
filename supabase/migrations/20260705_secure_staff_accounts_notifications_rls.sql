-- Hotfix: protect staff account secrets and notification visibility without
-- changing the existing custom staff_account_login flow.

create or replace function public.dawaa_current_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
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

create or replace function public.dawaa_current_account_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select lower(coalesce(role, ''))
  from public.staff_accounts
  where id = public.dawaa_current_user_id()
    and coalesce(active, true) = true
    and coalesce(can_login, true) = true
  limit 1
$$;

create or replace function public.dawaa_current_staff_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select staff_id
  from public.staff_accounts
  where id = public.dawaa_current_user_id()
    and coalesce(active, true) = true
    and coalesce(can_login, true) = true
  limit 1
$$;

create or replace function public.dawaa_current_permissions()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(permissions, '{}'::jsonb)
  from public.staff_accounts
  where id = public.dawaa_current_user_id()
    and coalesce(active, true) = true
    and coalesce(can_login, true) = true
  limit 1
$$;

create or replace function public.dawaa_is_staff_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.dawaa_current_account_role(), '') in (
    'admin',
    'general_manager',
    'executive_manager',
    'branches_manager',
    'branch_manager'
  )
$$;

create or replace function public.dawaa_can_manage_staff_accounts()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.dawaa_is_staff_admin()
    or coalesce((public.dawaa_current_permissions() ->> 'manage_staff_accounts')::boolean, false)
    or coalesce((public.dawaa_current_permissions() ->> 'view_staff_accounts')::boolean, false)
$$;

create or replace function public.dawaa_notification_visible_to_current_user(
  p_recipient_user_id uuid,
  p_user_id uuid,
  p_recipient_staff_id uuid,
  p_recipient_role text,
  p_branch text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.dawaa_is_staff_admin()
    or p_recipient_user_id = public.dawaa_current_user_id()
    or p_user_id = public.dawaa_current_user_id()
    or (p_recipient_staff_id is not null and p_recipient_staff_id = public.dawaa_current_staff_id())
    or (p_recipient_role is not null and lower(p_recipient_role) = public.dawaa_current_account_role())
    or (
      p_branch is not null
      and exists (
        select 1
        from public.staff_accounts a
        where a.id = public.dawaa_current_user_id()
          and lower(coalesce(a.branch, '')) = lower(coalesce(p_branch, ''))
          and coalesce(a.active, true) = true
          and coalesce(a.can_login, true) = true
      )
    )
$$;

create or replace function public.dawaa_enforce_notification_read_only_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.dawaa_is_staff_admin() then
    return new;
  end if;

  if (to_jsonb(new) - array['read', 'is_read', 'status', 'read_at'])
    <> (to_jsonb(old) - array['read', 'is_read', 'status', 'read_at']) then
    raise exception 'Only notification read state can be updated by this user';
  end if;

  if new.status is distinct from old.status and new.status <> 'read' then
    raise exception 'Only read status is allowed for this notification';
  end if;

  if coalesce(new.read, false) = false and coalesce(new.is_read, false) = false then
    raise exception 'Notification can only be marked as read';
  end if;

  return new;
end;
$$;

drop function if exists public.staff_account_login(text, text);

create or replace function public.staff_account_login(p_username text, p_password text)
returns table (
  id uuid,
  staff_id uuid,
  username text,
  name text,
  role text,
  branch text,
  phone text,
  active boolean,
  can_login boolean,
  permissions jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account record;
  v_password_ok boolean := false;
begin
  select *
  into v_account
  from public.staff_accounts a
  where a.username = p_username
    and coalesce(a.active, true) = true
    and coalesce(a.can_login, true) = true
  order by coalesce(a.updated_at, a.created_at) desc nulls last
  limit 1;

  if not found then
    return;
  end if;

  v_password_ok :=
    coalesce(v_account.temporary_password, '') = p_password
    or coalesce(v_account.password_hash, '') = p_password;

  if not v_password_ok and v_account.password_hash is not null and to_regprocedure('crypt(text,text)') is not null then
    execute 'select crypt($1, $2) = $2'
    into v_password_ok
    using p_password, v_account.password_hash;
  end if;

  if not coalesce(v_password_ok, false) then
    return;
  end if;

  update public.staff_accounts
  set last_login_at = now()
  where staff_accounts.id = v_account.id;

  return query
  select
    v_account.id::uuid,
    v_account.staff_id::uuid,
    v_account.username::text,
    coalesce(v_account.staff_name, v_account.name, v_account.username)::text as name,
    coalesce(v_account.role, '')::text as role,
    coalesce(v_account.branch, '')::text as branch,
    null::text as phone,
    coalesce(v_account.active, true)::boolean as active,
    coalesce(v_account.can_login, true)::boolean as can_login,
    coalesce(v_account.permissions, '{}'::jsonb)::jsonb as permissions;
end;
$$;

create or replace function public.list_staff_accounts_safe()
returns table (
  id uuid,
  staff_id uuid,
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
security definer
set search_path = public
as $$
  select
    a.id,
    a.staff_id,
    a.username,
    a.password_status,
    a.name,
    a.staff_name,
    a.role,
    a.branch,
    a.active,
    a.can_login,
    a.visible_in_admin,
    coalesce(a.permissions, '{}'::jsonb) as permissions,
    a.last_login_at,
    a.updated_at,
    a.created_at
  from public.staff_accounts a
  where public.dawaa_can_manage_staff_accounts()
  order by coalesce(a.name, a.staff_name, a.username)
$$;

create or replace function public.resolve_staff_account_safe(p_identifier text)
returns table (
  id uuid,
  staff_id uuid,
  username text,
  name text,
  staff_name text,
  role text,
  branch text,
  active boolean,
  can_login boolean
)
language sql
security definer
set search_path = public
as $$
  with input as (
    select trim(coalesce(p_identifier, '')) as value
  )
  select
    a.id,
    a.staff_id,
    a.username,
    a.name,
    a.staff_name,
    a.role,
    a.branch,
    a.active,
    a.can_login
  from public.staff_accounts a, input i
  where coalesce(a.active, true) = true
    and (
      a.id::text = i.value
      or a.staff_id::text = i.value
      or a.username = i.value
      or lower(coalesce(a.name, '')) = lower(i.value)
      or lower(coalesce(a.staff_name, '')) = lower(i.value)
      or public.dawaa_can_manage_staff_accounts()
    )
  order by
    case
      when a.id::text = (select value from input) then 1
      when a.staff_id::text = (select value from input) then 2
      when a.username = (select value from input) then 3
      else 4
    end,
    coalesce(a.updated_at, a.created_at) desc nulls last
  limit 500
$$;

create or replace function public.count_staff_accounts_without_staff_safe()
returns integer
language sql
security definer
set search_path = public
as $$
  select case
    when public.dawaa_can_manage_staff_accounts()
      then (select count(*)::integer from public.staff_accounts where staff_id is null)
    else null
  end
$$;

alter table if exists public.staff_accounts enable row level security;
alter table if exists public.notifications enable row level security;

do $$
begin
  drop policy if exists staff_accounts_no_public_select on public.staff_accounts;
  drop policy if exists staff_accounts_self_safe_read on public.staff_accounts;
  drop policy if exists staff_accounts_admin_manage on public.staff_accounts;
  drop policy if exists notifications_select_visible on public.notifications;
  drop policy if exists notifications_insert_active_user on public.notifications;
  drop policy if exists notifications_update_own_read_state on public.notifications;
  drop policy if exists notifications_admin_manage on public.notifications;
end $$;

create policy staff_accounts_self_safe_read
on public.staff_accounts
for select
using (
  id = public.dawaa_current_user_id()
  or staff_id = public.dawaa_current_staff_id()
  or public.dawaa_can_manage_staff_accounts()
);

create policy staff_accounts_admin_manage
on public.staff_accounts
for all
using (public.dawaa_can_manage_staff_accounts())
with check (public.dawaa_can_manage_staff_accounts());

create policy notifications_select_visible
on public.notifications
for select
using (
  public.dawaa_notification_visible_to_current_user(
    recipient_user_id,
    user_id,
    recipient_staff_id,
    recipient_role,
    branch
  )
);

create policy notifications_insert_active_user
on public.notifications
for insert
with check (public.dawaa_current_user_id() is not null);

create policy notifications_update_own_read_state
on public.notifications
for update
using (
  public.dawaa_notification_visible_to_current_user(
    recipient_user_id,
    user_id,
    recipient_staff_id,
    recipient_role,
    branch
  )
)
with check (
  public.dawaa_notification_visible_to_current_user(
    recipient_user_id,
    user_id,
    recipient_staff_id,
    recipient_role,
    branch
  )
);

create policy notifications_admin_manage
on public.notifications
for all
using (public.dawaa_is_staff_admin())
with check (public.dawaa_is_staff_admin());

drop trigger if exists daw_notification_read_only_update on public.notifications;
create trigger daw_notification_read_only_update
before update on public.notifications
for each row
execute function public.dawaa_enforce_notification_read_only_update();

update public.staff_accounts
set
  active = false,
  can_login = false,
  password_status = coalesce(nullif(password_status, ''), 'force_password_change')
where lower(username) = 'admin'
  and (
    coalesce(temporary_password, '') in ('admin123', 'admin', '123456')
    or coalesce(password_hash, '') in ('admin123', 'admin', '123456')
  );

grant execute on function public.staff_account_login(text, text) to anon, authenticated;
grant execute on function public.set_current_user_context(uuid) to anon, authenticated;
grant execute on function public.get_user_permissions(uuid) to anon, authenticated;
grant execute on function public.list_staff_accounts_safe() to anon, authenticated;
grant execute on function public.resolve_staff_account_safe(text) to anon, authenticated;
grant execute on function public.count_staff_accounts_without_staff_safe() to anon, authenticated;

revoke select on public.staff_accounts from anon, authenticated;
grant insert, update on public.staff_accounts to anon, authenticated;
grant select, insert, update on public.notifications to anon, authenticated;

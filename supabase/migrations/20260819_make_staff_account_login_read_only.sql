-- Prevent login from blocking on a write lock while staff_accounts is busy.
-- Authentication must only read the account; login activity is already logged
-- asynchronously by the frontend after a successful login.

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

  -- Important: no UPDATE here. A login must never block on last_login_at.
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

grant execute on function public.staff_account_login(text, text) to anon, authenticated;

create or replace function public.staff_account_login_v2(
  p_username text,
  p_password text
)
returns table (
  id uuid,
  staff_id text,
  username text,
  name text,
  role text,
  branch text,
  phone text,
  active boolean,
  can_login boolean,
  permissions jsonb,
  session_token text
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_login record;
  v_token text;
  v_canonical_username text;
begin
  select a.username
  into v_canonical_username
  from public.staff_accounts a
  where lower(btrim(a.username)) = lower(btrim(coalesce(p_username, '')))
    and coalesce(a.active, true) = true
    and coalesce(a.can_login, true) = true
  order by coalesce(a.updated_at, a.created_at) desc nulls last
  limit 1;

  if v_canonical_username is null then
    return;
  end if;

  select *
  into v_login
  from public.staff_account_login(v_canonical_username, p_password)
  limit 1;

  if not found then
    return;
  end if;

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  update public.staff_login_sessions
  set revoked_at = now()
  where staff_account_id = v_login.id
    and revoked_at is null
    and expires_at <= now();

  insert into public.staff_login_sessions (
    staff_account_id,
    token_hash,
    expires_at
  )
  values (
    v_login.id,
    encode(extensions.digest(v_token, 'sha256'), 'hex'),
    now() + interval '12 hours'
  );

  return query
  select
    v_login.id::uuid,
    v_login.staff_id::text,
    v_login.username::text,
    v_login.name::text,
    v_login.role::text,
    v_login.branch::text,
    v_login.phone::text,
    v_login.active::boolean,
    v_login.can_login::boolean,
    coalesce(v_login.permissions, '{}'::jsonb)::jsonb,
    v_token::text;
end;
$$;

revoke all on function public.staff_account_login_v2(text, text) from public;
grant execute on function public.staff_account_login_v2(text, text) to anon, authenticated, service_role;

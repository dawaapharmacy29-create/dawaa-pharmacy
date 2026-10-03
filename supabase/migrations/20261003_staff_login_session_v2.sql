-- Canonical staff login session for privileged server actions (Sales Intelligence refresh, etc.).
-- The browser keeps only the opaque token; the database stores SHA-256 hashes only.

create table if not exists public.staff_login_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_account_id uuid not null references public.staff_accounts(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);

alter table public.staff_login_sessions enable row level security;

create index if not exists staff_login_sessions_account_idx
  on public.staff_login_sessions (staff_account_id);
create index if not exists staff_login_sessions_expiry_idx
  on public.staff_login_sessions (expires_at)
  where revoked_at is null;

create or replace function public.staff_account_login_v2(p_username text, p_password text)
returns table(
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
set search_path to 'public', 'extensions'
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
  ) values (
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

create or replace function public.refresh_staff_login_session_v1(p_session_token text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_session_id uuid;
begin
  if nullif(btrim(coalesce(p_session_token, '')), '') is null then
    return false;
  end if;

  select s.id
  into v_session_id
  from public.staff_login_sessions s
  join public.staff_accounts a on a.id = s.staff_account_id
  where s.token_hash = encode(extensions.digest(btrim(p_session_token), 'sha256'), 'hex')
    and s.revoked_at is null
    and s.expires_at > now()
    and coalesce(a.active, true) = true
    and coalesce(a.is_active, true) = true
    and coalesce(a.can_login, true) = true
    and coalesce(a.status, 'active') = 'active'
  limit 1;

  if v_session_id is null then
    return false;
  end if;

  update public.staff_login_sessions
  set last_used_at = now(),
      expires_at = now() + interval '12 hours'
  where id = v_session_id;

  return true;
end;
$$;

create or replace function public.revoke_staff_login_session_v1(p_session_token text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_session_id uuid;
begin
  if nullif(btrim(coalesce(p_session_token, '')), '') is null then
    return false;
  end if;

  update public.staff_login_sessions
  set revoked_at = now(),
      last_used_at = now()
  where token_hash = encode(extensions.digest(btrim(p_session_token), 'sha256'), 'hex')
    and revoked_at is null
  returning id into v_session_id;

  return v_session_id is not null;
end;
$$;

grant execute on function public.staff_account_login_v2(text, text) to anon, authenticated;
grant execute on function public.refresh_staff_login_session_v1(text) to anon, authenticated;
grant execute on function public.revoke_staff_login_session_v1(text) to anon, authenticated;

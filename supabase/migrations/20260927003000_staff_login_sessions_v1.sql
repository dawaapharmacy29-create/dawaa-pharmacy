create table if not exists public.staff_login_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_account_id uuid not null references public.staff_accounts(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists staff_login_sessions_account_idx
  on public.staff_login_sessions(staff_account_id);

create index if not exists staff_login_sessions_expiry_idx
  on public.staff_login_sessions(expires_at)
  where revoked_at is null;

alter table public.staff_login_sessions enable row level security;

revoke all on table public.staff_login_sessions from public, anon, authenticated;
grant all on table public.staff_login_sessions to service_role;

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
set search_path = public
as $$
declare
  v_login record;
  v_token text;
begin
  select *
  into v_login
  from public.staff_account_login(p_username, p_password)
  limit 1;

  if not found then
    return;
  end if;

  v_token := encode(gen_random_bytes(32), 'hex');

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
    encode(digest(v_token, 'sha256'), 'hex'),
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

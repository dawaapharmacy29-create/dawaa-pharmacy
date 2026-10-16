-- Fixture for 20261016090000_staff_actor_session_identity_once_per_call_v1: the Production identity chain
-- (dawaa_current_staff_account_id_strict -> dawaa_request_staff_identifier -> dawaa_session_account_id_v1).
-- dawaa_current_staff_account_id_strict and dawaa_request_staff_identifier are the exact Production texts.
-- dawaa_session_account_id_v1 keeps the Production lookup rules (token length, revoked, expiry, account flags)
-- but hashes with md5 instead of extensions.digest and counts its executions in test.session_lookups.
create role anon;
create role authenticated;
create role service_role bypassrls;
create schema auth;
create or replace function auth.uid() returns uuid language sql stable
as $$ select nullif(current_setting('test.auth_uid', true), '')::uuid $$;

create table public.staff_accounts (
  id uuid primary key,
  staff_id text,
  username text,
  role text,
  branch text,
  active boolean,
  is_active boolean,
  can_login boolean,
  status text,
  auth_user_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz
);
create table public.user_profiles (auth_user_id uuid, staff_account_id uuid, role text, active boolean, permissions jsonb);
create table public.staff_login_sessions (
  id uuid primary key default gen_random_uuid(),
  staff_account_id uuid not null references public.staff_accounts(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create or replace function public.dawaa_session_account_id_v1()
returns uuid language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  v_token text := btrim(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-dawaa-session-token');
  v_id uuid;
begin
  perform set_config('test.session_lookups',
    (coalesce(nullif(current_setting('test.session_lookups', true), ''), '0')::int + 1)::text, false);
  select a.id into v_id
  from public.staff_login_sessions s
  join public.staff_accounts a on a.id = s.staff_account_id
  where length(v_token) between 32 and 512
    and s.token_hash = md5(v_token)
    and s.revoked_at is null
    and s.expires_at > now()
    and coalesce(a.active, true) = true
    and coalesce(a.is_active, true) = true
    and coalesce(a.can_login, true) = true
    and coalesce(a.status, 'active') = 'active'
  limit 1;
  return v_id;
end;
$function$;

create or replace function public.dawaa_request_staff_identifier()
returns text language sql stable
as $$
  select public.dawaa_session_account_id_v1()::text;
$$;

-- Production definition before 20261016090000 (identical to 20260823184500).
create or replace function public.dawaa_current_staff_account_id_strict()
returns uuid
language sql
stable security definer
set search_path to 'public','auth','pg_catalog'
as $$
  with request_identity as (
    select public.dawaa_request_staff_identifier() as value
  )
  select coalesce(
    (
      select a.id
      from public.staff_accounts a
      where auth.uid() is not null
        and a.auth_user_id = auth.uid()
        and coalesce(a.active,false)
        and coalesce(a.can_login,false)
      limit 1
    ),
    (
      select a.id
      from public.user_profiles up
      join public.staff_accounts a on a.id = up.staff_account_id
      where auth.uid() is not null
        and up.auth_user_id = auth.uid()
        and coalesce(up.active,false)
        and coalesce(a.active,false)
        and coalesce(a.can_login,false)
      limit 1
    ),
    (
      select a.id
      from public.staff_accounts a, request_identity r
      where r.value is not null
        and coalesce(a.active,false)
        and coalesce(a.can_login,false)
        and (
          a.id::text = r.value
          or a.staff_id::text = r.value
          or lower(trim(coalesce(a.username,''))) = lower(r.value)
        )
      order by
        case
          when a.id::text = r.value then 1
          when a.staff_id::text = r.value then 2
          else 3
        end,
        coalesce(a.updated_at,a.created_at) desc nulls last
      limit 1
    )
  );
$$;
revoke all on function public.dawaa_current_staff_account_id_strict() from public;
grant execute on function public.dawaa_current_staff_account_id_strict() to anon, authenticated, service_role;

-- 40 active login accounts (Production has 39) plus inactive and non-login ones.
insert into public.staff_accounts (id, staff_id, username, role, branch, active, can_login, auth_user_id, updated_at)
select ('00000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid,
       ('10000000-0000-4000-8000-' || lpad(g::text, 12, '0')),
       'user' || g, case when g = 1 then 'general_manager' else 'pharmacist' end, 'فرع شكري',
       g <= 40, g <= 40 or g > 45,
       case when g in (2, 3) then ('20000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid end,
       now() - (g || ' minutes')::interval
from generate_series(1, 50) g;

-- user_profiles path: auth user 99 maps to account 4.
insert into public.user_profiles (auth_user_id, staff_account_id, role, active, permissions)
values ('20000000-0000-4000-8000-000000000099', '00000000-0000-4000-8000-000000000004', 'pharmacist', true, '{}');

-- Sessions (token = 'token-' || n padded to 40 chars).
insert into public.staff_login_sessions (staff_account_id, token_hash, expires_at, revoked_at) values
  ('00000000-0000-4000-8000-000000000001', md5(rpad('token-valid-gm', 40, 'x')), now() + interval '1 day', null),
  ('00000000-0000-4000-8000-000000000005', md5(rpad('token-valid-pharmacist', 40, 'x')), now() + interval '1 day', null),
  ('00000000-0000-4000-8000-000000000006', md5(rpad('token-expired', 40, 'x')), now() - interval '1 minute', null),
  ('00000000-0000-4000-8000-000000000007', md5(rpad('token-revoked', 40, 'x')), now() + interval '1 day', now()),
  ('00000000-0000-4000-8000-000000000042', md5(rpad('token-inactive-account', 40, 'x')), now() + interval '1 day', null),
  ('00000000-0000-4000-8000-000000000046', md5(rpad('token-no-login-account', 40, 'x')), now() + interval '1 day', null);

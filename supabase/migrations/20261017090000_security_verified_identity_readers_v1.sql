-- SECURITY: caller identity comes only from the verified staff session, never from x-dawaa-user-id.
--
-- Supersedes the identity part of 20261008120000_verified_staff_session_identity_v1 (which cannot be
-- applied as written: its record_conversation_review_points_v1 anchor no longer exists in Production,
-- and 4 of its 10 functions were already delivered by 20261013195000). This migration touches ONLY
-- what is still header-based in Production, and nothing else:
--
--   * dawaa_current_staff_id_v1()                 header -> verified session
--   * dawaa_current_notification_account_id_v1()  header -> verified session
--   * dawaa_has_active_app_session()              header -> verified session
--   * new primitives dawaa_request_context_is_client_v1() and dawaa_bind_actor_v1(uuid|text),
--     used by the p_actor_id binding migrations that follow (reviewed bodies from 20261008120000).
--
-- Canonical identity chain reused (already live): x-dawaa-session-token -> dawaa_session_account_id_v1()
-- -> dawaa_request_staff_identifier() -> dawaa_current_staff_account_id_strict(). The Supabase Auth
-- fallback (auth.uid()) of the replaced functions is kept unchanged; only the header is removed.
--
-- Forward-only, no business-row DML, fail closed on catalog drift, idempotent on re-run.

-- 0. Drift guards: the canonical chain must be exactly the reviewed Production bodies, and each function
--    replaced here must be either the captured Production body (first run) or this migration's body (re-run).
do $guard$
declare
  r record;
begin
  for r in
    select * from (values
      ('public.dawaa_session_account_id_v1()', array['edba3bedf32fb7b7b43de630530d140c']),
      ('public.dawaa_current_staff_account_id_strict()', array['bdfb21e6a066f00b471329bbe77bc4d5']),
      ('public.dawaa_current_staff_id_v1()', array['8d4fcc6d3ac39338fcb69b476580d370', 'd41c5a01bb76ae9d775099c6bf01e76d']),
      ('public.dawaa_current_notification_account_id_v1()', array['c2ccb8b7f9af65dc13159fbde8e0af1b', '0dfa664fd2d21ad78619cf46787d3a57']),
      ('public.dawaa_has_active_app_session()', array['0d0846c25d2bff26859cd1639e7f730c', 'bc0f93caa8784b9f3940d070fc526a75'])
    ) as t(signature, allowed_md5)
  loop
    if to_regprocedure(r.signature) is null then
      raise exception 'identity readers v1: % is missing', r.signature;
    end if;
    if not (select md5(prosrc) = any(r.allowed_md5) from pg_proc where oid = to_regprocedure(r.signature)) then
      raise exception 'identity readers v1: % drifted from the reviewed Production body (md5 %); re-review before applying',
        r.signature, (select md5(prosrc) from pg_proc where oid = to_regprocedure(r.signature));
    end if;
  end loop;
end
$guard$;

-- 1. Request-context and actor-binding primitives (bodies as reviewed in 20261008120000).
create or replace function public.dawaa_request_context_is_client_v1()
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog'
as $function$
  with claims as (
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') as role
  )
  select c.role in ('anon', 'authenticated')
      or (session_user = 'authenticator' and c.role <> 'service_role')
  from claims c
$function$;

comment on function public.dawaa_request_context_is_client_v1() is
  'True for browser/PostgREST requests (anon or authenticated). False for cron, migrations and service_role.';

create or replace function public.dawaa_bind_actor_v1(p_actor uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select case
    when not public.dawaa_request_context_is_client_v1() then p_actor
    else (
      select case when p_actor is not null and p_actor = v.id then p_actor else v.id end
      from (select public.dawaa_current_staff_account_id_strict() as id) v
    )
  end
$function$;

create or replace function public.dawaa_bind_actor_v1(p_actor text)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select case
    when not public.dawaa_request_context_is_client_v1() then p_actor
    else (
      select case
        when v.id is null then null
        when nullif(btrim(coalesce(p_actor, '')), '') is not null and (
          btrim(p_actor) = v.id::text
          or btrim(p_actor) = coalesce(a.staff_id::text, '')
          or lower(btrim(p_actor)) = lower(btrim(coalesce(a.username, '')))
        ) then p_actor
        else v.id::text
      end
      from (select public.dawaa_current_staff_account_id_strict() as id) v
      left join public.staff_accounts a on a.id = v.id
    )
  end
$function$;

comment on function public.dawaa_bind_actor_v1(uuid) is
  'Binds a client-supplied actor id to the verified caller in client requests; passthrough for server contexts.';
comment on function public.dawaa_bind_actor_v1(text) is
  'Binds a client-supplied actor identifier (id, staff_id or username) to the verified caller in client requests; passthrough for server contexts.';

revoke all on function public.dawaa_request_context_is_client_v1() from public;
revoke all on function public.dawaa_bind_actor_v1(uuid) from public;
revoke all on function public.dawaa_bind_actor_v1(text) from public;
grant execute on function public.dawaa_request_context_is_client_v1() to anon, authenticated, service_role;
grant execute on function public.dawaa_bind_actor_v1(uuid) to anon, authenticated, service_role;
grant execute on function public.dawaa_bind_actor_v1(text) to anon, authenticated, service_role;

-- 2. The three header readers. Signatures, return types, volatility, SECURITY DEFINER and the existing
--    search_path are unchanged; CREATE OR REPLACE keeps owner and EXECUTE grants.
create or replace function public.dawaa_current_staff_id_v1()
returns text
language sql
stable security definer
set search_path to 'public'
as $function$
  select sa.staff_id::text
  from public.staff_accounts sa
  where sa.id::text = coalesce(
    public.dawaa_session_account_id_v1()::text,
    nullif(auth.uid()::text, '')
  )
  limit 1
$function$;

create or replace function public.dawaa_current_notification_account_id_v1()
returns text
language sql
stable security definer
set search_path to 'public', 'auth', 'pg_catalog'
as $function$
  select coalesce(
    public.dawaa_session_account_id_v1()::text,
    nullif(auth.uid()::text, '')
  )
$function$;

create or replace function public.dawaa_has_active_app_session()
returns boolean
language sql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select exists (
    select 1
    from public.staff_accounts sa
    where sa.id::text = coalesce(
      public.dawaa_session_account_id_v1()::text,
      nullif(auth.uid()::text, '')
    )
      and coalesce(sa.active, true) = true
      and coalesce(sa.can_login, true) = true
  );
$function$;

-- 2b. Repository-only legacy reader. 20260705_secure_staff_accounts_notifications_rls created
--     dawaa_current_user_id() from the header (and an unverified app.current_user_id GUC). It was never applied
--     to Production, but any database replayed from this repository (staging, local) would have it. Replace it
--     only where it exists and still reads the header; elsewhere this is a no-op.
do $legacy$
begin
  if to_regprocedure('public.dawaa_current_user_id()') is not null
     and (select prosrc from pg_proc where oid = to_regprocedure('public.dawaa_current_user_id()')) like '%x-dawaa-user-id%' then
    execute $ddl$
      create or replace function public.dawaa_current_user_id()
      returns uuid
      language sql
      stable
      security definer
      set search_path = public
      as $body$
        select coalesce(
          public.dawaa_session_account_id_v1(),
          nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
        )
      $body$
    $ddl$;
  end if;
end
$legacy$;

-- 3. Post-conditions: no function in public reads the unauthenticated header any more.
do $post$
declare
  v_readers text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by 1) into v_readers
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and p.prosrc like '%x-dawaa-user-id%';
  if v_readers is not null then
    raise exception 'identity readers v1: functions still read x-dawaa-user-id: %', v_readers;
  end if;
end
$post$;

-- Restore the verified staff-session identity primitives used by conversation-review saves.
-- Identity must come only from x-dawaa-session-token; never from x-dawaa-user-id.

create or replace function public.dawaa_session_account_id_v1()
returns uuid
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_catalog'
as $function$
  with token as (
    select btrim(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-dawaa-session-token') as value
  )
  select a.id
  from token t
  join public.staff_login_sessions s
    on s.token_hash = encode(extensions.digest(t.value, 'sha256'), 'hex')
  join public.staff_accounts a on a.id = s.staff_account_id
  where length(t.value) between 32 and 512
    and s.revoked_at is null
    and s.expires_at > now()
    and coalesce(a.active, true) = true
    and coalesce(a.is_active, true) = true
    and coalesce(a.can_login, true) = true
    and coalesce(a.status, 'active') = 'active'
  limit 1
$function$;

revoke all on function public.dawaa_session_account_id_v1() from public;
grant execute on function public.dawaa_session_account_id_v1() to anon, authenticated, service_role;

create or replace function public.dawaa_request_staff_identifier()
returns text
language sql
stable
set search_path to 'public', 'pg_catalog'
as $function$
  select public.dawaa_session_account_id_v1()::text;
$function$;

create or replace function public.dawaa_request_staff_id()
returns uuid
language sql
stable
set search_path to 'public', 'pg_catalog'
as $function$
  select public.dawaa_session_account_id_v1();
$function$;

create or replace function public.employee_operating_actor_id()
returns text
language sql
stable
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(
    public.dawaa_session_account_id_v1()::text,
    nullif(current_setting('request.jwt.claim.sub', true), '')
  );
$function$;

-- record_conversation_review_points_v1 already verifies p_session_token itself and carries
-- x-dawaa-session-token for downstream canonical writers. Guard against future schema drift.
do $$
declare
  v_def text := pg_get_functiondef('public.record_conversation_review_points_v1(text,uuid)'::regprocedure);
begin
  if position('x-dawaa-session-token' in v_def) = 0 then
    raise exception 'conversation review points writer is not bound to verified staff session identity';
  end if;
end $$;

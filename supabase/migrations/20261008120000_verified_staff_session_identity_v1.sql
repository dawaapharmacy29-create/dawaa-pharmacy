-- Verified staff session identity (security hardening).
--
-- Problem: the staff app does not use Supabase Auth. Every PostgREST call runs as `anon`, and the
-- database identified the caller from the unauthenticated `x-dawaa-user-id` request header
-- (public.dawaa_request_staff_identifier and five sibling readers). Any holder of the public anon key
-- could send another employee's id, staff_id or username and act as them, including the general
-- manager. In addition, ~50 anon-executable SECURITY DEFINER RPCs authorised the caller from a
-- client-supplied `p_actor_id` argument.
--
-- Fix:
--   1. Identity comes only from the opaque login session token (`x-dawaa-session-token`), which is
--      hashed and matched against public.staff_login_sessions (not expired, not revoked, account
--      active). `x-dawaa-user-id` is no longer read anywhere.
--   2. In client requests (anon / authenticated), every `p_actor_id` argument is bound to the verified
--      caller: a value naming the caller is kept as-is, anything else is replaced by the caller's
--      account id (or null when there is no verified caller). Server contexts (cron, service_role,
--      migrations) keep their explicit actor.
--   3. Previous definitions of every function rewritten here are snapshotted in
--      public.dawaa_identity_hardening_snapshot_v1 for exact rollback
--      (supabase/sql/ROLLBACK_20261008_verified_staff_session_identity_v1.sql).



-- ---------------------------------------------------------------------------------------------
-- 0. Snapshot of the definitions this migration replaces (rollback source, never exposed).
-- ---------------------------------------------------------------------------------------------
create table if not exists public.dawaa_identity_hardening_snapshot_v1 (
  signature text primary key,
  definition text not null,
  definition_md5 text not null,
  captured_at timestamptz not null default now()
);
alter table public.dawaa_identity_hardening_snapshot_v1 enable row level security;
revoke all on public.dawaa_identity_hardening_snapshot_v1 from public, anon, authenticated;

create temporary table _identity_bind_targets (signature regprocedure primary key, lang text not null) on commit drop;
insert into _identity_bind_targets(signature, lang) values
  ('public.calculate_customer_loyalty_cycle(uuid,date,date,numeric,text,text)', 'plpgsql'),
  ('public.calculate_customer_loyalty_cycle_internal_v1(uuid,date,date,numeric,text,text)', 'plpgsql'),
  ('public.customer_followup_performance_v1(text,text,date,date)', 'plpgsql'),
  ('public.dawaa_assert_customer_intelligence_branch_v2(text,uuid)', 'plpgsql'),
  ('public.dawaa_can_access_review_coverage_branch_v1(uuid,text,boolean)', 'plpgsql'),
  ('public.dawaa_can_manage_branch_targets(uuid)', 'plpgsql'),
  ('public.dawaa_cancel_customer_followup_v1(text,text,text,text)', 'plpgsql'),
  ('public.dawaa_complete_customer_followup_v1(text,text,text,numeric,text,text,text)', 'plpgsql'),
  ('public.dawaa_customer_request_permission_allowed(uuid,text)', 'plpgsql'),
  ('public.dawaa_log_customer_followup_event_v1(text,text,text,text,text,jsonb,text,text)', 'plpgsql'),
  ('public.dawaa_shortage_permission_allowed_v1(uuid,text)', 'plpgsql'),
  ('public.fetch_customer_welcome_message_logs(text,text,text,text,text,text,text,text,date,date)', 'plpgsql'),
  ('public.get_customer_followup_records_v1(text,text,text,text,date,date,integer,integer)', 'plpgsql'),
  ('public.get_customer_service_at_risk_daily_v2(date,uuid)', 'plpgsql'),
  ('public.get_customer_service_cycle_cohorts(text,date,integer,uuid)', 'plpgsql'),
  ('public.get_customer_service_first_purchase_save_v2(date,uuid)', 'plpgsql'),
  ('public.get_customer_service_recent_top50_v2(integer,uuid)', 'plpgsql'),
  ('public.get_customer_service_three_cycle_intelligence_v1(date,uuid)', 'plpgsql'),
  ('public.get_customer_service_watchlist_performance(text,date,integer,uuid)', 'plpgsql'),
  ('public.get_weekly_manager_metrics_cached_v1(uuid,text,text,date,date)', 'plpgsql'),
  ('public.get_weekly_manager_metrics_fast_v1(uuid,text,text,date,date,integer)', 'plpgsql'),
  ('public.import_customer_followup_results_legacy_v1(uuid,text,text,jsonb)', 'plpgsql'),
  ('public.import_customer_followup_results_v1(uuid,text,text,jsonb)', 'plpgsql'),
  ('public.import_customer_service_queue_results_legacy_v4(uuid,text,text,jsonb)', 'plpgsql'),
  ('public.import_customer_service_queue_results_v2(uuid,text,text,jsonb)', 'plpgsql'),
  ('public.import_customer_service_queue_results_v3(uuid,text,text,jsonb)', 'plpgsql'),
  ('public.import_customer_service_queue_results_v4(uuid,text,text,jsonb)', 'plpgsql'),
  ('public.list_weekly_manager_evaluation_subjects_v1(uuid,text)', 'plpgsql'),
  ('public.mark_customer_points_contacted_v2(text,text,text,uuid)', 'plpgsql'),
  ('public.review_customer_loyalty_approval(uuid,text,text,text)', 'plpgsql'),
  ('public.review_customer_loyalty_approval_internal_v1(uuid,text,text,text)', 'plpgsql'),
  ('public.run_due_customer_loyalty_cycles(text,text)', 'plpgsql'),
  ('public.run_due_customer_loyalty_cycles_internal_v1(text,text)', 'plpgsql'),
  ('public.save_branch_sales_target_v2(uuid,text,numeric)', 'plpgsql'),
  ('public.save_quick_reply_script(uuid,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,boolean,text,text)', 'plpgsql'),
  ('public.save_staff_monthly_evaluation_safe(uuid,jsonb)', 'plpgsql'),
  ('public.set_branch_daily_task_status(uuid,text,uuid,text,text,text)', 'plpgsql'),
  ('public.set_branch_sales_target(text,numeric,uuid)', 'plpgsql'),
  ('public.submit_customer_loyalty_approval(uuid,date,date,numeric,text,text,text)', 'plpgsql'),
  ('public.submit_customer_loyalty_approval_internal_v1(uuid,date,date,numeric,text,text,text)', 'plpgsql'),
  ('public.update_customer_welcome_message_status(uuid,text,text,text)', 'plpgsql'),
  ('public.app_actor_is_team_dawaa(text)', 'sql'),
  ('public.app_role_allowed(text,text[])', 'sql'),
  ('public.app_staff_role(text)', 'sql'),
  ('public.dawaa_can_access_customer_intelligence_branch_v2(text,uuid)', 'sql'),
  ('public.dawaa_can_manage_customer_intelligence_v2(uuid)', 'sql'),
  ('public.dawaa_customer_service_queue_scope_v3(uuid)', 'sql'),
  ('public.get_customer_points_daily20_v2(date,uuid)', 'sql'),
  ('public.get_customer_service_at_risk_completion_v1(date,uuid)', 'sql'),
  ('public.get_customer_service_daily_queue_completion_v1(date,uuid)', 'sql'),
  ('public.get_customer_service_daily_vip7_v2(date,uuid)', 'sql'),
  ('public.get_customer_service_plus500_v2(date,uuid)', 'sql');

insert into public.dawaa_identity_hardening_snapshot_v1(signature, definition, definition_md5)
select format('public.%s(%s)', p.proname, oidvectortypes(p.proargtypes)), pg_get_functiondef(p.oid), md5(pg_get_functiondef(p.oid))
from pg_proc p
where p.oid in (
  select signature::oid from _identity_bind_targets
  union all
  select to_regprocedure(s)::oid from unnest(array[
    'public.dawaa_request_staff_identifier()',
    'public.dawaa_request_staff_id()',
    'public.dawaa_current_notification_account_id_v1()',
    'public.dawaa_current_staff_id_v1()',
    'public.dawaa_has_active_app_session()',
    'public.employee_operating_actor_id()',
    'public.record_conversation_review_points_v1(text,uuid)'
  ]) s
)
on conflict (signature) do nothing;

do $$
declare v_expected integer; v_have integer;
begin
  select count(*) + 7 into v_expected from _identity_bind_targets;
  select count(*) into v_have from public.dawaa_identity_hardening_snapshot_v1;
  if v_have <> v_expected then
    raise exception 'identity hardening: expected % snapshotted functions, found %', v_expected, v_have;
  end if;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 1. Verified identity primitives.
-- ---------------------------------------------------------------------------------------------
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

comment on function public.dawaa_session_account_id_v1() is
  'Staff account id proven by the x-dawaa-session-token request header (hashed, live, not revoked). The only header-derived identity source.';

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

revoke all on function public.dawaa_session_account_id_v1() from public;
revoke all on function public.dawaa_request_context_is_client_v1() from public;
revoke all on function public.dawaa_bind_actor_v1(uuid) from public;
revoke all on function public.dawaa_bind_actor_v1(text) from public;
grant execute on function public.dawaa_session_account_id_v1() to anon, authenticated, service_role;
grant execute on function public.dawaa_request_context_is_client_v1() to anon, authenticated, service_role;
grant execute on function public.dawaa_bind_actor_v1(uuid) to anon, authenticated, service_role;
grant execute on function public.dawaa_bind_actor_v1(text) to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 2. Every header-based identity reader now resolves the verified session account.
--    Signatures, return types, volatility and grants are unchanged (CREATE OR REPLACE).
-- ---------------------------------------------------------------------------------------------
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

create or replace function public.dawaa_current_staff_id_v1()
returns text
language sql
stable security definer
set search_path to 'public', 'auth', 'pg_catalog'
as $function$
  select sa.staff_id::text
  from public.staff_accounts sa
  where sa.id::text = coalesce(
    public.dawaa_session_account_id_v1()::text,
    nullif(auth.uid()::text, '')
  )
  limit 1
$function$;

create or replace function public.dawaa_has_active_app_session()
returns boolean
language sql
stable security definer
set search_path to 'public', 'auth', 'pg_catalog'
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

-- record_conversation_review_points_v1 verifies p_session_token itself and then rewrites
-- request.headers for its downstream calls; carry the verified token instead of a bare id.
do $$
declare
  v_def text := pg_get_functiondef('public.record_conversation_review_points_v1(text,uuid)'::regprocedure);
  v_old text := $q$jsonb_build_object('x-dawaa-user-id',v_account.id::text)$q$;
  v_new text := $q$jsonb_build_object('x-dawaa-session-token',btrim(p_session_token))$q$;
begin
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'identity hardening: record_conversation_review_points_v1 header rewrite anchor not found exactly once';
  end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- ---------------------------------------------------------------------------------------------
-- 3. Bind every client-reachable p_actor_id to the verified caller.
-- ---------------------------------------------------------------------------------------------
do $$
declare
  r record;
  v_src text;
  v_def text;
  v_body text;
  v_new_src text;
  v_body_pos integer;
  v_bind_line constant text := E'\n  p_actor_id := public.dawaa_bind_actor_v1(p_actor_id); -- verified caller binding (identity hardening v1)';
begin
  for r in
    select t.signature, t.lang, p.prosrc, l.lanname
    from _identity_bind_targets t
    join pg_proc p on p.oid = t.signature::oid
    join pg_language l on l.oid = p.prolang
    order by t.signature::text
  loop
    if r.lanname <> r.lang then
      raise exception 'identity hardening: % expected language %, found %', r.signature, r.lang, r.lanname;
    end if;
    v_src := r.prosrc;
    if v_src like '%dawaa_bind_actor_v1%' then
      continue; -- already bound (idempotent re-run)
    end if;

    if r.lang = 'plpgsql' then
      -- DECLARE initialisers run before the first BEGIN, so the binding must happen in an outer block:
      -- the original body (declare ... begin ... end) becomes an unchanged nested block.
      if v_src ~ '^\s*#' then
        raise exception 'identity hardening: compiler directive prologue in %', r.signature;
      end if;
      v_body := rtrim(v_src, E' \t\r\n');
      if v_body !~* '\mend\s*;?$' then
        raise exception 'identity hardening: body of % does not end with END', r.signature;
      end if;
      v_new_src := E'\nbegin' || v_bind_line || E'\n' || v_body
        || case when right(v_body, 1) = ';' then '' else ';' end
        || E'\nend;\n';
    else
      if v_src ~* '''[^'']*\mp_actor_id\M[^'']*''' then
        raise exception 'identity hardening: p_actor_id inside a string literal in %', r.signature;
      end if;
      -- Scalar sub-select => evaluated once per call (InitPlan), never once per scanned row.
      v_new_src := regexp_replace(v_src, '\mp_actor_id\M', '(select public.dawaa_bind_actor_v1(p_actor_id))', 'g');
      if v_new_src = v_src then
        raise exception 'identity hardening: no p_actor_id reference in %', r.signature;
      end if;
    end if;

    v_def := pg_get_functiondef(r.signature::oid);
    v_body_pos := position(v_src in v_def);
    if v_body_pos = 0 then
      raise exception 'identity hardening: body not located in definition of %', r.signature;
    end if;
    execute overlay(v_def placing v_new_src from v_body_pos for length(v_src));
  end loop;
end $$;

-- ---------------------------------------------------------------------------------------------
-- 4. Post-conditions.
-- ---------------------------------------------------------------------------------------------
do $$
declare v_missing text; v_header_readers text; v_bad_grants text;
begin
  select string_agg(t.signature::text, ', ') into v_missing
  from _identity_bind_targets t join pg_proc p on p.oid = t.signature::oid
  where p.prosrc not like '%dawaa_bind_actor_v1(p_actor_id)%';
  if v_missing is not null then
    raise exception 'identity hardening: unbound actor functions: %', v_missing;
  end if;

  select string_agg(p.oid::regprocedure::text, ', ') into v_header_readers
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosrc like '%x-dawaa-user-id%';
  if v_header_readers is not null then
    raise exception 'identity hardening: functions still read x-dawaa-user-id: %', v_header_readers;
  end if;

  select string_agg(s.signature, ', ') into v_bad_grants
  from public.dawaa_identity_hardening_snapshot_v1 s
  where to_regprocedure(s.signature) is null;
  if v_bad_grants is not null then
    raise exception 'identity hardening: snapshotted functions disappeared: %', v_bad_grants;
  end if;
end $$;

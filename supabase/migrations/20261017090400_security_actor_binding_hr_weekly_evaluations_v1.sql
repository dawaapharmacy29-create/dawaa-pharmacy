-- SECURITY: bind client-supplied p_actor_id to the verified staff session. HR: weekly manager evaluation metrics and subject lists.
--
-- All three resolved the actor with "where a.id = p_actor_id", so any caller could read as any manager.
--
-- Requires 20261017090000 (dawaa_bind_actor_v1 / dawaa_request_context_is_client_v1). In client requests a
-- p_actor_id naming the verified caller is kept; anything else becomes the verified caller (NULL without a live
-- session). Cron, migrations and service_role keep their explicit actor (passthrough).
-- Signatures, grants, owner, SECURITY DEFINER and search_path are unchanged. No business-row DML.
-- Forward-only, fail closed on drift, idempotent (an already bound function is skipped).

do $guard$
begin
  if to_regprocedure('public.dawaa_bind_actor_v1(uuid)') is null
     or to_regprocedure('public.dawaa_bind_actor_v1(text)') is null then
    raise exception 'actor binding: 20261017090000_security_verified_identity_readers_v1 must be applied first';
  end if;
end
$guard$;

-- In-place binding helper (session-local pg_temp function, dropped at the end; never a runtime object).
-- For one function: fail closed unless its body is the reviewed Production body (md5) or already bound;
-- then insert public.dawaa_bind_actor_v1(p_actor_id) into the CURRENT live body, so newer Production
-- logic is never replaced by an older repository copy.
create or replace function pg_temp.dawaa_bind_actor_in_place(p_signature text, p_expected_md5 text)
returns text
language plpgsql
as $helper$
declare
  v_oid oid := to_regprocedure(p_signature);
  v_src text;
  v_lang text;
  v_def text;
  v_body text;
  v_new_src text;
  v_pos integer;
begin
  if v_oid is null then
    raise exception 'actor binding: % is missing', p_signature;
  end if;
  select p.prosrc, l.lanname into v_src, v_lang
  from pg_proc p join pg_language l on l.oid = p.prolang
  where p.oid = v_oid;

  if v_src like '%dawaa_bind_actor_v1(p_actor_id)%' then
    return 'already_bound';
  end if;
  if md5(v_src) <> p_expected_md5 then
    raise exception 'actor binding: % drifted from the reviewed Production body (md5 % <> %); re-review before applying',
      p_signature, md5(v_src), p_expected_md5;
  end if;
  if not exists (select 1 from pg_proc where oid = v_oid and 'p_actor_id' = any (proargnames)) then
    raise exception 'actor binding: % has no p_actor_id argument', p_signature;
  end if;

  if v_lang = 'plpgsql' then
    if v_src ~ '^\s*#' then
      raise exception 'actor binding: compiler directive prologue in %', p_signature;
    end if;
    v_body := rtrim(v_src, E' \t\r\n');
    if v_body !~* '\mend\s*;?$' then
      raise exception 'actor binding: body of % does not end with END', p_signature;
    end if;
    -- The original block (with its DECLARE initialisers) becomes an unchanged nested block that runs after
    -- the binding, so even initialisers such as coalesce(p_actor_id, ...) see the verified caller.
    v_new_src := E'\nbegin\n  p_actor_id := public.dawaa_bind_actor_v1(p_actor_id); -- dawaa:verified-actor-binding-v1\n'
      || v_body || case when right(v_body, 1) = ';' then '' else ';' end || E'\nend;\n';
  elsif v_lang = 'sql' then
    if v_src ~* '''[^'']*\mp_actor_id\M[^'']*''' then
      raise exception 'actor binding: p_actor_id inside a string literal in %', p_signature;
    end if;
    -- Scalar sub-select: evaluated once per call (InitPlan), never once per scanned row.
    v_new_src := regexp_replace(v_src, '\mp_actor_id\M', '(select public.dawaa_bind_actor_v1(p_actor_id))', 'g');
  else
    raise exception 'actor binding: unsupported language % for %', v_lang, p_signature;
  end if;

  v_def := pg_get_functiondef(v_oid);
  v_pos := position(v_src in v_def);
  if v_pos = 0 then
    raise exception 'actor binding: body not located in definition of %', p_signature;
  end if;
  execute overlay(v_def placing v_new_src from v_pos for length(v_src));

  if not exists (select 1 from pg_proc where oid = v_oid and prosrc like '%dawaa_bind_actor_v1(p_actor_id)%') then
    raise exception 'actor binding: % not bound after rewrite', p_signature;
  end if;
  return 'bound';
end
$helper$;

do $migration$
declare
  r record;
begin
  for r in
    select * from (values
      ('public.get_weekly_manager_metrics_cached_v1(uuid,text,text,date,date)', '5d065214ee5ac82949a0a4956c54af1a'),
      ('public.get_weekly_manager_metrics_fast_v1(uuid,text,text,date,date,integer)', '5b14b3a342f5aaa855be37c6d183dd27'),
      ('public.list_weekly_manager_evaluation_subjects_v1(uuid,text)', 'cf097ae247c99eb2672e0f51a27849be')
    ) as t(signature, expected_md5)
  loop
    raise notice 'actor binding: % -> %', r.signature, pg_temp.dawaa_bind_actor_in_place(r.signature, r.expected_md5);
  end loop;
end
$migration$;

drop function pg_temp.dawaa_bind_actor_in_place(text, text);

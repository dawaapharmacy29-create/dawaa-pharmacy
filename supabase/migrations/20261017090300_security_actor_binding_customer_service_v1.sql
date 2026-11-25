-- SECURITY: bind client-supplied p_actor_id to the verified staff session. Customer service: queue scope, customer intelligence, follow-up performance/records, welcome messages, quick replies.
--
-- dawaa_customer_service_queue_scope_v3 and the two customer-intelligence gatekeepers used
-- coalesce(p_actor_id, verified caller): a supplied actor overrode the session. The follow-up readers and the
-- two writers resolved the actor directly from p_actor_id (and recorded it as sent_by / created_by).
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
      ('public.dawaa_customer_service_queue_scope_v3(uuid)', '6e875ddce9009ffe337c06bd048416c9'),
      ('public.dawaa_can_access_customer_intelligence_branch_v2(text,uuid)', '5d92cdc7ee246bbe52631600f796bd9e'),
      ('public.dawaa_can_manage_customer_intelligence_v2(uuid)', 'c3bb57002f9789010b4669937ab2a8dc'),
      ('public.customer_followup_performance_v1(text,text,date,date)', 'b4a8e71e916b97c707a7cb6e7a30fb2e'),
      ('public.get_customer_followup_records_v1(text,text,text,text,date,date,integer,integer)', '3a062f9bd527d3607b29eb40f1339ad5'),
      ('public.update_customer_welcome_message_status(uuid,text,text,text)', '8e01753eb3b2f3a4e42ba8b286577c50'),
      ('public.save_quick_reply_script(uuid,text,text,text,text,text,text,text,jsonb,jsonb,jsonb,boolean,text,text)', '522783421165413ae587dffb4731ecca')
    ) as t(signature, expected_md5)
  loop
    raise notice 'actor binding: % -> %', r.signature, pg_temp.dawaa_bind_actor_in_place(r.signature, r.expected_md5);
  end loop;
end
$migration$;

drop function pg_temp.dawaa_bind_actor_in_place(text, text);

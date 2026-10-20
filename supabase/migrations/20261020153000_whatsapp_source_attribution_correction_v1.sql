-- Source-only forward candidate. NOT APPLIED to Production; requires explicit owner approval.
-- 1) One shared database rule: only an operating branch (فرع شكري / فرع الشامي, the keys of
--    dawaa_customer_request_branch_key) is a transaction branch for new operational work.
-- 2) Customer-request approval and the public materializer enforce that rule in the database. A
--    canonical request proposal is approvable/executable only while the CURRENT published analysis
--    still qualifies it, its resolved conversation staff evidence does not name another doctor, and
--    a doctor from another home branch has an audited human cross-branch confirmation. Legacy
--    (non-canonical) proposals keep their existing approval contract.
-- 3) One authorized, audited command corrects a source's raw text, staff and transaction branch.
--    The database recomputes the source hash from the text and stored conversation times. It never
--    changes customer identity, never deletes evidence, and retires unexecuted proposals by freeing
--    their identity so the next explicit refresh projects exactly one corrected proposal.
-- 4) A canonical request proposal can only be inserted with the source's CURRENT staff/branch, so
--    a refresh that read the source before a correction cannot publish a stale proposal.
-- 5) A correction retires the previous source hash into whatsapp_review_source_hash_aliases (same
--    canonical source, unique hash); no new source may claim a retired hash, so re-uploading the
--    pre-correction export can neither create a parallel source nor revert the correction.
-- No business DML, backfill, automatic re-analysis or execution. New grants: the correction
-- command (authenticated) and SELECT on the alias registry under the sources' visibility.

create or replace function public.dawaa_is_transaction_branch_v1(p_branch text)
returns boolean
language sql
immutable
set search_path to 'public','pg_catalog'
as $function$
  -- Mirrors isOperatingBranch in src/lib/branch.ts (stricter for unrecognized spellings).
  select coalesce(public.dawaa_customer_request_branch_key(p_branch) in ('shokry','elshamy'), false)
$function$;

revoke all on function public.dawaa_is_transaction_branch_v1(text) from public,anon;
grant execute on function public.dawaa_is_transaction_branch_v1(text) to authenticated,service_role;

-- Browser ingest/re-analysis only FILL blank attribution. Once stored, the conversation text,
-- hash, customer, staff and branch change only through the audited correction command below
-- (or server roles), never through a direct client UPDATE with no audit.
create or replace function public.dawaa_guard_whatsapp_source_attribution_v1()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog'
as $function$
begin
  if current_user in ('postgres','service_role','supabase_admin') then return new; end if;
  if (nullif(btrim(coalesce(old.raw_text,'')),'') is not null and new.raw_text is distinct from old.raw_text)
     or (nullif(btrim(coalesce(old.source_hash,'')),'') is not null and new.source_hash is distinct from old.source_hash)
     or (old.customer_id is not null and new.customer_id is distinct from old.customer_id)
     or (old.staff_id is not null and new.staff_id is distinct from old.staff_id)
     or (nullif(btrim(coalesce(old.branch,'')),'') is not null and new.branch is distinct from old.branch) then
    raise exception 'source_attribution_requires_correction_command' using errcode='42501';
  end if;
  return new;
end;
$function$;

revoke all on function public.dawaa_guard_whatsapp_source_attribution_v1() from public,anon,authenticated;

drop trigger if exists whatsapp_source_attribution_guard_v1 on public.whatsapp_review_sources;
create trigger whatsapp_source_attribution_guard_v1
before update of raw_text, source_hash, customer_id, staff_id, branch
on public.whatsapp_review_sources
for each row
execute function public.dawaa_guard_whatsapp_source_attribution_v1();

-- True only while the current published canonical analysis still qualifies this exact request.
create or replace function public.dawaa_canonical_request_is_current_v1(
  p_source_id uuid,
  p_case_id text,
  p_request_key text,
  p_product_id uuid
)
returns boolean
language sql
stable
set search_path to 'public','pg_catalog'
as $function$
  select exists (
    select 1
    from public.sales_intelligence_cases c
    join public.sales_intelligence_case_analyses a
      on a.analysis_id=c.published_analysis_id and a.case_id=c.case_id
    cross join lateral jsonb_array_elements(
      coalesce(a.evidence_snapshot #> '{canonicalCustomerRequestAssessment,requests}','[]'::jsonb)) r
    where c.case_id=p_case_id and c.conversation_id=p_source_id and c.is_active
      and a.is_current and a.superseded_at is null
      and (select count(*) from public.sales_intelligence_case_analyses a2
           where a2.case_id=c.case_id and a2.is_current)=1
      and r->>'requestKey'=p_request_key
      and r->>'status'='qualified'
      and r->>'productId'=p_product_id::text
  )
$function$;

revoke all on function public.dawaa_canonical_request_is_current_v1(uuid,text,text,uuid)
  from public,anon,authenticated;
grant execute on function public.dawaa_canonical_request_is_current_v1(uuid,text,text,uuid) to service_role;

-- Why a canonical request's responsible doctor is NOT proven (null = proven). A staff id alone is
-- not proof when the current analysis resolved a different doctor from the conversation itself,
-- and a doctor whose home branch differs needs the latest audited correction to confirm the cover.
-- Account-wide management scope may serve any operating branch.
create or replace function public.dawaa_canonical_request_staff_refusal_v1(
  p_source_id uuid,
  p_case_id text,
  p_staff_id uuid,
  p_branch text
)
returns text
language plpgsql
stable
set search_path to 'public','pg_catalog'
as $function$
declare
  v_staff_branch text;
  v_latest jsonb;
begin
  if exists (
    select 1
    from public.sales_intelligence_cases c
    join public.sales_intelligence_case_analyses a
      on a.analysis_id=c.published_analysis_id and a.case_id=c.case_id
    cross join lateral jsonb_array_elements(
      coalesce(a.evidence_snapshot #> '{caseIntelligence,staff,participants}','[]'::jsonb)) p
    where c.case_id=p_case_id and c.conversation_id=p_source_id and c.is_active and a.is_current
      and nullif(p->>'staffId','') is not null
      and p->>'staffId' is distinct from p_staff_id::text
  ) then
    return 'customer_request_action_staff_evidence_conflict';
  end if;

  select s.branch into v_staff_branch from public.staff s where s.id=p_staff_id;
  if position('كل' in coalesce(v_staff_branch,'')) > 0
     or public.dawaa_customer_request_branch_key(v_staff_branch)
        is not distinct from public.dawaa_customer_request_branch_key(p_branch) then
    return null;
  end if;

  select au.after_state into v_latest
  from public.whatsapp_review_audit au
  where au.source_id=p_source_id and au.action='source_attribution_corrected_v1'
  order by au.created_at desc, au.id desc
  limit 1;
  if v_latest->>'staff_id' = p_staff_id::text
     and public.dawaa_customer_request_branch_key(v_latest->>'branch')
       = public.dawaa_customer_request_branch_key(p_branch)
     and v_latest->>'cross_branch_cover' = 'true' then
    return null;
  end if;
  return 'customer_request_action_cross_branch_requires_confirmation';
end;
$function$;

revoke all on function public.dawaa_canonical_request_staff_refusal_v1(uuid,text,uuid,text)
  from public,anon,authenticated;
grant execute on function public.dawaa_canonical_request_staff_refusal_v1(uuid,text,uuid,text) to service_role;

create or replace function public.dawaa_approve_whatsapp_customer_request_action_v2(p_action_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_action public.whatsapp_conversation_actions%rowtype;
  v_source public.whatsapp_review_sources%rowtype;
  v_actor_name text;
  v_actor_role text;
  v_product_code text;
  v_staff_refusal text;
begin
  if v_actor is null
     or not public.dawaa_current_actor_can(array['approve_reviews','manage_conversation_evaluations','manage_customer_requests']) then
    raise exception 'not_authorized' using errcode='42501';
  end if;

  select * into v_action
  from public.whatsapp_conversation_actions
  where id=p_action_id
  for update;
  if not found then raise exception 'whatsapp_action_not_found'; end if;
  if v_action.action_type<>'customer_request' then raise exception 'customer_request_action_required'; end if;
  -- A concurrent or repeated approval of the same proposal is a read, not a second approval.
  if v_action.status='ready' and coalesce(v_action.auto_eligible,false)
     and coalesce(v_action.payload->>'approvalSource','')='human_review_v2' then
    return jsonb_build_object('ok',true,'action_id',p_action_id,'status','ready','already_approved',true);
  end if;
  if v_action.status not in ('proposed','ready') then raise exception 'customer_request_action_not_approvable'; end if;
  if v_action.customer_id is null or v_action.product_id is null or v_action.staff_id is null then
    raise exception 'customer_request_action_canonical_identity_required';
  end if;
  if coalesce(v_action.confidence,0) < 80 then raise exception 'customer_request_action_confidence_too_low'; end if;

  select s.* into v_source
  from public.whatsapp_review_sources s
  join public.whatsapp_operational_canonical_sources_v1 c on c.source_id=s.id
  where s.id=v_action.source_id;
  if not found then raise exception 'customer_request_action_source_not_canonical'; end if;

  if v_source.customer_id is null or v_action.customer_id is distinct from v_source.customer_id then
    raise exception 'customer_request_action_customer_mismatch';
  end if;
  if v_source.staff_id is null or v_action.staff_id is distinct from v_source.staff_id then
    raise exception 'customer_request_action_staff_mismatch';
  end if;
  if public.dawaa_customer_request_branch_key(v_action.branch)
       is distinct from public.dawaa_customer_request_branch_key(v_source.branch) then
    raise exception 'customer_request_action_branch_mismatch';
  end if;
  if not public.dawaa_is_transaction_branch_v1(v_action.branch)
     or not public.dawaa_is_transaction_branch_v1(v_source.branch) then
    raise exception 'customer_request_action_transaction_branch_required';
  end if;
  if v_action.created_by='si-canonical-customer-request-projection-v1'
     and not public.dawaa_canonical_request_is_current_v1(
       v_action.source_id, v_action.payload->>'caseId', v_action.payload->>'requestKey', v_action.product_id
     ) then
    raise exception 'customer_request_requires_current_qualification';
  end if;
  if v_action.created_by='si-canonical-customer-request-projection-v1' then
    v_staff_refusal := public.dawaa_canonical_request_staff_refusal_v1(
      v_action.source_id, v_action.payload->>'caseId', v_action.staff_id, v_action.branch);
    if v_staff_refusal is not null then raise exception '%', v_staff_refusal; end if;
  end if;

  if not public.dawaa_can_access_customer_request_branch('manage_customer_requests',v_action.branch) then
    raise exception 'customer_request_action_branch_denied' using errcode='42501';
  end if;
  if not exists(select 1 from public.customers c where c.id=v_action.customer_id) then
    raise exception 'customer_not_found';
  end if;

  select nullif(trim(p.product_code),'') into v_product_code
  from public.products p
  where p.id=v_action.product_id;
  if v_product_code is null then raise exception 'canonical_product_required'; end if;
  if nullif(trim(coalesce(v_action.product_code,'')),'') is null
     or trim(v_action.product_code)<>v_product_code then
    raise exception 'customer_request_action_product_identity_mismatch';
  end if;

  if not exists(
    select 1 from public.staff s
    where s.id=v_action.staff_id and coalesce(s.active,s.is_active,true)=true
  ) then raise exception 'active_staff_required'; end if;

  select coalesce(nullif(trim(sa.name),''),nullif(trim(sa.staff_name),''),nullif(trim(sa.username),''),'مستخدم'),
         lower(trim(coalesce(sa.role,'')))
  into v_actor_name,v_actor_role
  from public.staff_accounts sa where sa.id=v_actor;

  update public.whatsapp_conversation_actions
  set status='ready',
      auto_eligible=true,
      payload=coalesce(payload,'{}'::jsonb) || jsonb_build_object(
        'approvalSource','human_review_v2',
        'approvedBy',v_actor::text,
        'approvedByName',v_actor_name,
        'approvedAt',now()
      ),
      updated_at=now()
  where id=p_action_id;

  insert into public.whatsapp_review_audit(source_id,action,actor_id,actor_name,actor_role,before_state,after_state,note)
  values(v_action.source_id,'customer_request_action_approved_v2',v_actor::text,v_actor_name,v_actor_role,
    to_jsonb(v_action),
    jsonb_build_object(
      'action_id',p_action_id,
      'status','ready',
      'auto_eligible',true,
      'customer_id',v_action.customer_id,
      'staff_id',v_action.staff_id,
      'product_id',v_action.product_id,
      'product_code',v_product_code,
      'branch',v_action.branch,
      'quantity',v_action.quantity,
      'confidence',v_action.confidence
    ),
    'تم اعتماد تسجيل طلب العميل بعد مراجعة الهوية والصنف والمصدر القانوني.');

  return jsonb_build_object('ok',true,'action_id',p_action_id,'status','ready');
end;
$function$;

revoke all on function public.dawaa_approve_whatsapp_customer_request_action_v2(uuid) from public;
grant execute on function public.dawaa_approve_whatsapp_customer_request_action_v2(uuid)
  to anon,authenticated,service_role;

create or replace function public.dawaa_materialize_whatsapp_action_v1(p_action_id uuid)
returns jsonb language plpgsql security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_action public.whatsapp_conversation_actions%rowtype;
  v_source public.whatsapp_review_sources%rowtype;
  v_source_id uuid;
  v_case record;
  v_staff_refusal text;
begin
  if v_actor is null then raise exception 'not_authorized' using errcode='42501'; end if;
  if not public.dawaa_current_actor_can(array[
    'add_reviews','reviews.action.create','edit_reviews','manage_conversation_evaluations'
  ]) then raise exception 'whatsapp_action_execute_permission_denied' using errcode='42501'; end if;
  select source_id into v_source_id from public.whatsapp_conversation_actions where id=p_action_id;
  if not found then raise exception 'whatsapp_action_not_found'; end if;
  select * into v_source from public.whatsapp_review_sources where id=v_source_id for update;
  if not found then raise exception 'whatsapp_source_not_found'; end if;
  perform pg_advisory_xact_lock(hashtext('sales_intelligence_case_set:' || v_source_id::text));
  for v_case in select case_id from public.sales_intelligence_cases
    where conversation_id=v_source_id order by case_id
  loop
    perform pg_advisory_xact_lock(hashtext('sales_intelligence_case_analyses:' || v_case.case_id));
  end loop;
  select * into v_action from public.whatsapp_conversation_actions where id=p_action_id for update;
  if not found or v_action.source_id is distinct from v_source_id then
    raise exception 'whatsapp_action_source_changed';
  end if;
  if not public.dawaa_can_read_conversation_review_row_v2(
    v_actor,v_source.staff_id,null::uuid,v_source.branch,null::uuid
  ) then raise exception 'whatsapp_action_access_denied' using errcode='42501'; end if;
  -- New operational work is never created in account-wide scope / an unknown branch. A completed
  -- customer-request retry is a read of existing lineage and keeps its own target check below.
  if v_action.action_type in ('customer_request','customer_followup','recommendation_followup','complaint_followup')
     and v_action.status<>'created'
     and not public.dawaa_is_transaction_branch_v1(v_action.branch) then
    raise exception 'whatsapp_action_transaction_branch_required';
  end if;
  if v_action.created_by='si-canonical-followup-projection-v1'
     and v_action.action_type='customer_followup'
     and v_action.target_table is null and v_action.target_id is null then
    if v_action.status<>'ready'
       or v_action.payload->>'canonicalLifecycle' is distinct from 'active'
       or v_action.branch is distinct from v_source.branch
       or (v_source.customer_id is not null and v_action.customer_id is distinct from v_source.customer_id)
       or not exists(select 1 from public.whatsapp_operational_canonical_sources_v1 where source_id=v_source_id)
       or not exists (
         select 1 from public.sales_intelligence_cases c
         join public.sales_intelligence_case_analyses a
           on a.analysis_id=c.published_analysis_id and a.case_id=c.case_id
         cross join lateral jsonb_array_elements(coalesce(
           a.evidence_snapshot #> '{caseIntelligence,followUp,opportunities}',
           a.evidence_snapshot #> '{followUp,opportunities}','[]')) o
         where c.case_id=v_action.payload->>'caseId' and c.conversation_id=v_source_id and c.is_active
           and c.published_analysis_id::text=v_action.payload->>'canonicalAnalysisId'
           and a.is_current and a.superseded_at is null
           and (select count(*) from public.sales_intelligence_case_analyses a2
             where a2.case_id=c.case_id and a2.is_current)=1
           and o->>'followUpKey'=v_action.followup_identity and o->>'status'='actionable'
           and nullif(o->>'blocker','') is null
           and nullif(o->>'customerId','') is not distinct from v_action.customer_id::text
           and o->>'reason'=v_action.payload->>'canonicalReason'
       ) then raise exception 'canonical_followup_requires_current_projection'; end if;
  end if;
  if v_action.action_type='customer_request' then
    if not public.dawaa_can_access_customer_request_branch('manage_customer_requests',v_action.branch) then
      raise exception 'customer_request_materialization_permission_denied' using errcode='42501';
    end if;
    if v_action.status='created' then
      -- Retry is a read of the completed operation, not a new approval or insertion.
      -- Require a real target belonging to the same operational identities.
      if v_action.target_table is distinct from 'customer_requests'
         or v_action.target_id is null or not exists (
           select 1 from public.customer_requests r
           where r.id=v_action.target_id::uuid
             and r.customer_id::text=v_action.customer_id::text
             and r.product_id=v_action.product_id and r.doctor_id=v_action.staff_id
             and public.dawaa_customer_request_branch_key(r.branch)
               =public.dawaa_customer_request_branch_key(v_action.branch)
         ) then raise exception 'customer_request_created_target_mismatch'; end if;
    elsif v_action.status<>'ready' or not coalesce(v_action.auto_eligible,false)
       or coalesce(v_action.payload->>'approvalSource','')<>'human_review_v2'
       or nullif(v_action.payload->>'approvedBy','') is null
       or nullif(v_action.payload->>'approvedAt','') is null then
      raise exception 'customer_request_requires_explicit_approval';
    elsif v_action.created_by='si-canonical-customer-request-projection-v1'
       and not public.dawaa_canonical_request_is_current_v1(
         v_source_id, v_action.payload->>'caseId', v_action.payload->>'requestKey', v_action.product_id
       ) then
      -- An approval made before a re-analysis withdrew the qualification is no longer executable.
      raise exception 'customer_request_requires_current_qualification';
    elsif v_action.created_by='si-canonical-customer-request-projection-v1' then
      v_staff_refusal := public.dawaa_canonical_request_staff_refusal_v1(
        v_source_id, v_action.payload->>'caseId', v_action.staff_id, v_action.branch);
      if v_staff_refusal is not null then raise exception '%', v_staff_refusal; end if;
      if v_action.staff_id is distinct from v_source.staff_id
         or public.dawaa_customer_request_branch_key(v_action.branch)
           is distinct from public.dawaa_customer_request_branch_key(v_source.branch) then
        raise exception 'customer_request_action_source_attribution_changed';
      end if;
    end if;
  end if;
  return public.dawaa_materialize_whatsapp_action_core_v2(p_action_id);
end;
$function$;
revoke all on function public.dawaa_materialize_whatsapp_action_v1(uuid) from public;
grant execute on function public.dawaa_materialize_whatsapp_action_v1(uuid) to anon,authenticated,service_role;

-- Retired source hashes. A correction changes the source hash; the previous hash stays bound to
-- the SAME canonical source here, so re-uploading the pre-correction export resolves to that
-- source instead of creating a parallel one, and never reverts the audited correction.
create table if not exists public.whatsapp_review_source_hash_aliases (
  source_hash text primary key check (length(btrim(source_hash)) > 0),
  source_id uuid not null references public.whatsapp_review_sources(id) on delete restrict,
  correction_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_review_source_hash_aliases_source_idx
  on public.whatsapp_review_source_hash_aliases(source_id);
alter table public.whatsapp_review_source_hash_aliases enable row level security;
revoke all on table public.whatsapp_review_source_hash_aliases from public, anon, authenticated;
grant select on table public.whatsapp_review_source_hash_aliases to authenticated;
grant all on table public.whatsapp_review_source_hash_aliases to service_role;
drop policy if exists whatsapp_review_source_hash_aliases_select_v1 on public.whatsapp_review_source_hash_aliases;
-- Same visibility as the source itself (the sources RLS applies inside the subquery).
create policy whatsapp_review_source_hash_aliases_select_v1 on public.whatsapp_review_source_hash_aliases
  for select to authenticated
  using (exists (select 1 from public.whatsapp_review_sources s where s.id = source_id));

-- No new source may claim a retired hash (any role). The advisory lock is shared with the
-- correction command, so an upload racing an in-flight correction waits and then sees the alias.
-- unique_violation lets existing ingest duplicate handling resolve the canonical source.
-- SECURITY DEFINER: the guard must see every retired hash, not only those whose source the
-- uploading employee may read under RLS; it reveals nothing but the refusal itself.
create or replace function public.dawaa_guard_whatsapp_source_hash_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if new.source_hash is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext('whatsapp_source_hash:' || new.source_hash));
  if exists (select 1 from public.whatsapp_review_source_hash_aliases a
             where a.source_hash = new.source_hash
               and (tg_op = 'INSERT' or a.source_id is distinct from new.id)) then
    raise exception 'source_hash_superseded_by_correction' using errcode = '23505';
  end if;
  return new;
end;
$function$;

revoke all on function public.dawaa_guard_whatsapp_source_hash_v1() from public, anon, authenticated;

drop trigger if exists whatsapp_source_hash_guard_v1 on public.whatsapp_review_sources;
create trigger whatsapp_source_hash_guard_v1
before insert or update of source_hash
on public.whatsapp_review_sources
for each row
execute function public.dawaa_guard_whatsapp_source_hash_v1();

-- Authorized, audited correction of ONE source's attribution. Re-analysis stays the separate,
-- explicit refresh command; this command never analyzes, projects, approves or materializes.
-- The database recomputes the canonical source hash (hashWhatsAppSession: SHA-256 of
-- "<startedAt ISO>|<endedAt ISO>|<raw text>") from the STORED conversation times, so the text,
-- hash and timeline cannot be desynchronized by a direct RPC caller.
create or replace function public.dawaa_correct_whatsapp_source_attribution_v1(
  p_source_id uuid,
  p_expected_source_hash text,
  p_raw_text text,
  p_source_hash text,
  p_staff_id uuid,
  p_branch text,
  p_reason text,
  p_cross_branch_cover boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
  v_source public.whatsapp_review_sources%rowtype;
  v_staff_name text;
  v_staff_branch text;
  v_cross_branch boolean := false;
  v_case record;
  v_actions jsonb;
  v_retired integer := 0;
  v_actor_name text;
  v_actor_role text;
  v_branch text := btrim(coalesce(p_branch,''));
  v_reason text := btrim(coalesce(p_reason,''));
  v_correction_id uuid := gen_random_uuid();
  v_server_hash text;
begin
  if v_actor is null or not public.dawaa_current_actor_can(array['approve_reviews']) then
    raise exception 'source_attribution_correction_permission_denied' using errcode='42501';
  end if;
  if char_length(v_reason) < 10 then raise exception 'source_attribution_correction_reason_required'; end if;
  if nullif(btrim(coalesce(p_raw_text,'')),'') is null then raise exception 'source_attribution_raw_text_required'; end if;
  if coalesce(p_source_hash,'') !~ '^[0-9a-f]{64}$' then raise exception 'source_attribution_hash_invalid'; end if;
  if p_staff_id is null then raise exception 'active_staff_required'; end if;
  if not public.dawaa_is_transaction_branch_v1(v_branch) then
    raise exception 'source_attribution_transaction_branch_required';
  end if;

  -- Same lock order as reconcile/materialize: source row -> case-set advisory -> case advisories.
  select * into v_source from public.whatsapp_review_sources where id=p_source_id for update;
  if not found then raise exception 'whatsapp_source_not_found'; end if;
  perform pg_advisory_xact_lock(hashtext('sales_intelligence_case_set:' || p_source_id::text));
  for v_case in select case_id from public.sales_intelligence_cases
    where conversation_id=p_source_id order by case_id
  loop
    perform pg_advisory_xact_lock(hashtext('sales_intelligence_case_analyses:' || v_case.case_id));
  end loop;

  if not public.dawaa_can_read_conversation_review_row_v2(v_actor,v_source.staff_id,null::uuid,v_source.branch,null::uuid)
     or not public.dawaa_can_read_conversation_review_row_v2(v_actor,p_staff_id,null::uuid,v_branch,null::uuid) then
    raise exception 'source_attribution_access_denied' using errcode='42501';
  end if;

  if v_source.conversation_started_at is null or v_source.conversation_ended_at is null then
    raise exception 'source_attribution_conversation_time_missing';
  end if;
  v_server_hash := encode(sha256(convert_to(
    to_char(v_source.conversation_started_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' ||
    to_char(v_source.conversation_ended_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' ||
    p_raw_text, 'UTF8')), 'hex');
  if v_server_hash is distinct from p_source_hash then
    raise exception 'source_attribution_hash_mismatch';
  end if;

  -- Exact replay of an already-applied correction is a no-op, not a second audit or retirement.
  if v_source.source_hash=p_source_hash and v_source.raw_text=p_raw_text
     and v_source.staff_id=p_staff_id and v_source.branch=v_branch then
    return jsonb_build_object('ok',true,'changed',false,'sourceId',p_source_id,'retiredActions',0);
  end if;
  if v_source.source_hash is distinct from p_expected_source_hash then
    raise exception 'source_attribution_source_changed';
  end if;

  if coalesce(v_source.review_status,'')='archived' then raise exception 'source_attribution_source_archived'; end if;
  if coalesce(v_source.reviewer_confirmed,false) or coalesce(v_source.invoice_link_confirmed,false)
     or v_source.invoice_link_confirmed_invoice_id is not null or v_source.official_review_id is not null then
    raise exception 'source_attribution_has_human_confirmation';
  end if;
  -- Executed, approved or human-worked operations keep their lineage; they need manual handling.
  if exists (
    select 1 from public.whatsapp_conversation_actions a
    where a.source_id=p_source_id and (
      a.status='created' or a.target_table is not null or a.target_id is not null
      or a.assigned_at is not null or coalesce(a.work_status,'unassigned')<>'unassigned'
      or a.started_at is not null or a.completed_at is not null
      or a.outcome is not null or a.outcome_note is not null
      or coalesce(a.followup_attempts,0)>0 or a.last_followup_at is not null
      or a.recovered_at is not null or a.recovered_invoice_id is not null
      or (a.action_type='customer_request' and coalesce(a.auto_eligible,false))
    )
  ) then
    raise exception 'source_attribution_has_executed_or_approved_work';
  end if;

  -- The responsible doctor is a canonical staff row, never the conversation's customer.
  select nullif(btrim(s.name),''), s.branch into v_staff_name, v_staff_branch
  from public.staff s
  where s.id=p_staff_id and coalesce(s.active,s.is_active,true)=true;
  if not found then raise exception 'active_staff_required'; end if;
  if (v_source.customer_id is not null and p_staff_id=v_source.customer_id)
     or exists(select 1 from public.customers c where c.id=p_staff_id) then
    raise exception 'source_attribution_staff_is_customer';
  end if;
  -- Home branch vs operation branch: account-wide management may serve any branch; any other
  -- home branch (including the warehouse) is cross-branch cover and needs explicit confirmation.
  v_cross_branch := position('كل' in coalesce(v_staff_branch,'')) = 0
    and public.dawaa_customer_request_branch_key(v_staff_branch)
      is distinct from public.dawaa_customer_request_branch_key(v_branch);
  if v_cross_branch and not coalesce(p_cross_branch_cover,false) then
    raise exception 'source_attribution_staff_branch_mismatch';
  end if;
  -- Serialize with uploads of either export (same advisory keys as the source-hash guard),
  -- in a fixed order so two corrections cannot deadlock.
  perform pg_advisory_xact_lock(hashtext('whatsapp_source_hash:' || h))
  from (select unnest(array[v_source.source_hash, p_source_hash]) h order by 1) ordered
  where h is not null;
  if exists(select 1 from public.whatsapp_review_sources s where s.source_hash=p_source_hash and s.id<>p_source_id)
     or exists(select 1 from public.whatsapp_review_source_hash_aliases a
               where a.source_hash=p_source_hash and a.source_id<>p_source_id) then
    raise exception 'source_attribution_hash_conflict';
  end if;

  -- Retire (never delete) unexecuted proposals made from the old attribution. Freeing their
  -- identity lets the next explicit refresh insert exactly one corrected proposal, while the old
  -- row, its evidence and its original identity remain readable.
  select coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb) into v_actions
  from public.whatsapp_conversation_actions a
  where a.source_id=p_source_id
    and (a.status in ('proposed','ready','error')
         or (a.status='dismissed' and a.payload->>'canonicalLifecycle'='withdrawn'))
    and a.payload->>'supersededByCorrection' is null;

  update public.whatsapp_conversation_actions a set
    status='dismissed',
    auto_eligible=false,
    action_key=a.action_key || '|superseded:' || a.id::text,
    followup_identity=case when a.followup_identity is null then null
      else a.followup_identity || '|superseded:' || a.id::text end,
    payload=coalesce(a.payload,'{}'::jsonb) || jsonb_build_object(
      'canonicalLifecycle','withdrawn',
      'canonicalWithdrawalReason','source_attribution_corrected',
      'supersededActionKey',a.action_key,
      'supersededIdentity',a.followup_identity,
      'supersededByCorrection',v_correction_id::text),
    updated_at=now()
  where a.source_id=p_source_id
    and (a.status in ('proposed','ready','error')
         or (a.status='dismissed' and a.payload->>'canonicalLifecycle'='withdrawn'))
    and a.payload->>'supersededByCorrection' is null;
  get diagnostics v_retired = row_count;

  -- Keep the previous export bound to this canonical source. A hash that becomes current again
  -- (a correction back to an earlier text of the same source) leaves the registry.
  delete from public.whatsapp_review_source_hash_aliases
  where source_hash=p_source_hash and source_id=p_source_id;
  if nullif(btrim(coalesce(v_source.source_hash,'')),'') is not null then
    insert into public.whatsapp_review_source_hash_aliases(source_hash,source_id,correction_id)
    values (v_source.source_hash, p_source_id, v_correction_id);
  end if;

  update public.whatsapp_review_sources set
    raw_text=p_raw_text,
    source_hash=p_source_hash,
    staff_id=p_staff_id,
    staff_name=coalesce(v_staff_name,staff_name),
    branch=v_branch,
    updated_at=now()
  where id=p_source_id;

  select coalesce(nullif(trim(sa.name),''),nullif(trim(sa.staff_name),''),nullif(trim(sa.username),''),'مستخدم'),
         lower(trim(coalesce(sa.role,'')))
  into v_actor_name,v_actor_role
  from public.staff_accounts sa where sa.id=v_actor;

  insert into public.whatsapp_review_audit(source_id,action,actor_id,actor_name,actor_role,before_state,after_state,note)
  values(p_source_id,'source_attribution_corrected_v1',v_actor::text,v_actor_name,v_actor_role,
    jsonb_build_object(
      'raw_text',v_source.raw_text,'source_hash',v_source.source_hash,
      'staff_id',v_source.staff_id,'staff_name',v_source.staff_name,'branch',v_source.branch,
      'customer_id',v_source.customer_id,'actions',v_actions),
    jsonb_build_object(
      'correction_id',v_correction_id,'source_hash',p_source_hash,
      'staff_id',p_staff_id,'staff_name',coalesce(v_staff_name,v_source.staff_name),'branch',v_branch,
      'staff_home_branch',v_staff_branch,'cross_branch_cover',v_cross_branch,
      'customer_id',v_source.customer_id,'retired_actions',v_retired,
      'reanalysis','required_explicit_refresh'),
    v_reason);

  return jsonb_build_object('ok',true,'changed',true,'sourceId',p_source_id,
    'correctionId',v_correction_id,'retiredActions',v_retired,'reanalysisRequired',true);
end;
$function$;

revoke all on function public.dawaa_correct_whatsapp_source_attribution_v1(uuid,text,text,text,uuid,text,text,boolean)
  from public,anon;
grant execute on function public.dawaa_correct_whatsapp_source_attribution_v1(uuid,text,text,text,uuid,text,text,boolean)
  to authenticated,service_role;

comment on function public.dawaa_correct_whatsapp_source_attribution_v1(uuid,text,text,text,uuid,text,text,boolean) is
  'Audited correction of one WhatsApp source''s raw text, staff and transaction branch. The hash is recomputed in the database; customer identity is immutable here; unexecuted proposals are retired, not deleted; re-analysis is a separate explicit refresh.';

-- A canonical request proposal is published only with the source's CURRENT attribution. FOR SHARE
-- waits for an in-flight correction, so a refresh that read the source earlier cannot insert a
-- stale proposal into the identity that correction just freed. The refresh reports the failure.
create or replace function public.dawaa_guard_canonical_request_projection_v1()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog'
as $function$
declare
  v_staff uuid;
  v_branch text;
begin
  select s.staff_id, s.branch into v_staff, v_branch
  from public.whatsapp_review_sources s where s.id=new.source_id for share;
  if not found
     or new.staff_id is distinct from v_staff
     or public.dawaa_customer_request_branch_key(new.branch)
       is distinct from public.dawaa_customer_request_branch_key(v_branch)
     or not public.dawaa_is_transaction_branch_v1(new.branch) then
    raise exception 'canonical_request_projection_stale_source';
  end if;
  return new;
end;
$function$;

revoke all on function public.dawaa_guard_canonical_request_projection_v1() from public,anon,authenticated;

drop trigger if exists canonical_request_projection_guard_v1 on public.whatsapp_conversation_actions;
create trigger canonical_request_projection_guard_v1
before insert
on public.whatsapp_conversation_actions
for each row
when (new.action_type='customer_request' and new.created_by='si-canonical-customer-request-projection-v1')
execute function public.dawaa_guard_canonical_request_projection_v1();

notify pgrst,'reload schema';

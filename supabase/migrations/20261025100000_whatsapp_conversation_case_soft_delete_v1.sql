-- General-manager soft delete of ONE WhatsApp case, or of a whole conversation with all its cases.
--
-- Contract:
--   * Logical, restorable deletion only. Nothing is physically deleted: the conversation, its cases,
--     analyses, evaluations, actions, the customer, invoices and their items, the V22 envelope and
--     its revenue ledger, and every audit row stay in place.
--   * Authorization is decided here, in the database: the strict staff session must be an active,
--     login-enabled general manager (role general_manager/admin). The UI only mirrors it.
--   * A deletion that would remove or change a proven sale proof, revenue, points or incentives, or
--     that would discard human/executed work, is refused with its impact. It never edits those rows.
--   * Delete and restore are one transaction each: same lock order as the case-set reconcile
--     (source row -> case-set advisory -> per-case advisories), an audit row in the same
--     transaction (if the audit insert fails, nothing is deleted or restored), idempotent by a
--     client request key, and fail-closed when the previewed impact changed meanwhile.
--   * A deleted case stays out of active lists and evaluations. Re-analysis cannot revive it: the
--     lifecycle columns of a deleted case are frozen and its analyses, automatic evaluations and
--     action proposals cannot become current/open again except through the explicit restore command.
--   * Restore writes a new audit event and reuses the same rows (no new evaluation, action or
--     revenue row is created).
--
-- Deployment order: apply this migration BEFORE deploying the matching application code. The
-- canonical refresh selects whatsapp_review_sources.deleted_at and sales_intelligence_cases.deleted_at.

create table if not exists public.whatsapp_conversation_deletions (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('case','conversation')),
  source_id uuid not null references public.whatsapp_review_sources(id) on delete restrict,
  case_ids text[] not null,
  reason text not null check (char_length(btrim(reason)) >= 10),
  request_key text not null unique check (request_key ~ '^[A-Za-z0-9:_-]{8,120}$'),
  impact jsonb not null,
  impact_fingerprint text not null,
  prior_state jsonb not null,
  status text not null default 'deleted' check (status in ('deleted','restored')),
  deleted_by uuid not null,
  deleted_by_name text,
  deleted_by_role text,
  deleted_at timestamptz not null default now(),
  delete_audit_id uuid not null,
  restore_request_key text unique check (restore_request_key ~ '^[A-Za-z0-9:_-]{8,120}$'),
  restore_reason text,
  restored_by uuid,
  restored_by_name text,
  restored_at timestamptz,
  restore_audit_id uuid,
  restore_result jsonb,
  constraint whatsapp_conversation_deletions_restore_state check (
    (status = 'deleted' and restored_at is null and restore_audit_id is null)
    or (status = 'restored' and restored_at is not null and restore_audit_id is not null
        and char_length(btrim(coalesce(restore_reason,''))) >= 10)
  )
);

create index if not exists whatsapp_conversation_deletions_source_idx
  on public.whatsapp_conversation_deletions(source_id, deleted_at desc);
create index if not exists whatsapp_conversation_deletions_status_idx
  on public.whatsapp_conversation_deletions(status, deleted_at desc);

alter table public.whatsapp_conversation_deletions enable row level security;
revoke all on table public.whatsapp_conversation_deletions from public, anon, authenticated;
grant select, insert, update on table public.whatsapp_conversation_deletions to service_role;

alter table public.whatsapp_review_sources
  add column if not exists deleted_at timestamptz,
  add column if not exists deletion_id uuid references public.whatsapp_conversation_deletions(id);
alter table public.sales_intelligence_cases
  add column if not exists deleted_at timestamptz,
  add column if not exists deletion_id uuid references public.whatsapp_conversation_deletions(id);

do $constraints$
begin
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_review_sources_deletion_pair_v1') then
    alter table public.whatsapp_review_sources add constraint whatsapp_review_sources_deletion_pair_v1
      check ((deleted_at is null) = (deletion_id is null));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sales_intelligence_cases_deletion_pair_v1') then
    alter table public.sales_intelligence_cases add constraint sales_intelligence_cases_deletion_pair_v1
      check ((deleted_at is null) = (deletion_id is null));
  end if;
end;
$constraints$;

create index if not exists whatsapp_review_sources_deleted_v1
  on public.whatsapp_review_sources(deleted_at) where deleted_at is not null;
create index if not exists sales_intelligence_cases_deleted_v1
  on public.sales_intelligence_cases(conversation_id) where deleted_at is not null;

-- ---------------------------------------------------------------------------------------------
-- Internal helpers (no client grant)
-- ---------------------------------------------------------------------------------------------

-- Set only for the duration of a delete/restore transaction by the commands below.
create or replace function public.dawaa_whatsapp_deletion_command_active_v1()
returns boolean
language sql
stable
set search_path to 'public','pg_catalog'
as $function$
  select nullif(current_setting('dawaa.whatsapp_deletion_command', true), '') is not null;
$function$;

create or replace function public.dawaa_whatsapp_source_is_deleted_v1(p_source_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
  select exists(select 1 from public.whatsapp_review_sources s
                where s.id = p_source_id and s.deleted_at is not null);
$function$;

create or replace function public.dawaa_whatsapp_case_is_deleted_v1(p_case_id text)
returns boolean
language sql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
  select exists(
    select 1 from public.sales_intelligence_cases c
    left join public.whatsapp_review_sources s on s.id = c.conversation_id
    where c.case_id = p_case_id and (c.deleted_at is not null or s.deleted_at is not null));
$function$;

-- The only actor allowed to delete or restore: an active, login-enabled general manager.
create or replace function public.dawaa_whatsapp_deletion_actor_v1()
returns table(actor_id uuid, actor_name text, actor_role text)
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor uuid := public.dawaa_current_staff_account_id_strict();
begin
  return query
  select sa.id,
         coalesce(nullif(btrim(sa.name),''), nullif(btrim(sa.staff_name),''), nullif(btrim(sa.username),''), 'مدير عام'),
         lower(btrim(coalesce(sa.role,'')))
  from public.staff_accounts sa
  where v_actor is not null and sa.id = v_actor
    and coalesce(sa.active,false) and coalesce(sa.can_login,false)
    and lower(btrim(coalesce(sa.role,''))) in ('general_manager','admin');
  if not found then
    raise exception 'whatsapp_deletion_general_manager_required' using errcode = '42501';
  end if;
end;
$function$;

-- Impact of deleting p_case_ids of p_source_id. Read-only; shared by preview and the command so
-- the confirmed preview and the executed scope are the same computation.
create or replace function public.dawaa_whatsapp_deletion_impact_v1(p_source_id uuid, p_scope text, p_case_ids text[])
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_source public.whatsapp_review_sources%rowtype;
  v_case_ids text[] := coalesce(p_case_ids, '{}'::text[]);
  v_conversation jsonb;
  v_cases jsonb;
  v_siblings jsonb;
  v_reviews jsonb;
  v_actions jsonb;
  v_unscoped_actions integer := 0;
  v_attributions jsonb;
  v_envelopes jsonb;
  v_blockers jsonb := '[]'::jsonb;
  v_body jsonb;
begin
  select * into v_source from public.whatsapp_review_sources where id = p_source_id;
  if not found then raise exception 'whatsapp_source_not_found'; end if;

  v_conversation := jsonb_build_object(
    'sourceId', v_source.id, 'customerId', v_source.customer_id, 'customerName', v_source.customer_name,
    'customerCode', v_source.customer_code, 'branch', v_source.branch, 'staffName', v_source.staff_name,
    'startedAt', v_source.conversation_started_at, 'endedAt', v_source.conversation_ended_at,
    'messageCount', v_source.message_count, 'sourceFilename', v_source.source_filename,
    'reviewStatus', v_source.review_status,
    'matchedInvoiceId', v_source.matched_invoice_id, 'matchedInvoiceNumber', v_source.matched_invoice_number,
    'invoiceLinkConfirmed', coalesce(v_source.invoice_link_confirmed,false),
    'invoiceLinkConfirmedInvoiceNumber', v_source.invoice_link_confirmed_invoice_number,
    'reviewerConfirmed', coalesce(v_source.reviewer_confirmed,false),
    'officialReviewId', v_source.official_review_id);

  select coalesce(jsonb_agg(jsonb_build_object(
      'caseId', c.case_id, 'isActive', c.is_active, 'publishedAnalysisId', c.published_analysis_id,
      'retireReason', c.retire_reason, 'branch', c.branch_name_raw,
      'startedAt', c.case_started_at, 'endedAt', c.case_ended_at,
      'caseType', ca.case_type, 'caseStatus', ca.case_status,
      'salesOutcome', ca.evidence_snapshot #>> '{canonicalSalesOutcome,outcome}',
      'saleProofState', ca.evidence_snapshot #>> '{canonicalSalesOutcome,saleProofState}')
      order by c.case_started_at, c.case_id), '[]'::jsonb)
    into v_cases
  from public.sales_intelligence_cases c
  left join lateral (
    select a.* from public.sales_intelligence_case_analyses a
    where a.case_id = c.case_id
    order by (a.analysis_id = c.published_analysis_id) desc, a.is_current desc, a.analysis_version desc
    limit 1) ca on true
  where c.case_id = any(v_case_ids);

  select coalesce(jsonb_agg(jsonb_build_object('caseId', c.case_id, 'isActive', c.is_active,
      'deleted', c.deleted_at is not null) order by c.case_started_at, c.case_id), '[]'::jsonb)
    into v_siblings
  from public.sales_intelligence_cases c
  where c.conversation_id = p_source_id and not (c.case_id = any(v_case_ids));

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'kind', r.evaluation_kind, 'isCurrent', r.is_current,
      'caseId', r.sales_intelligence_case_id, 'staffName', coalesce(r.doctor_name, r.staff_name),
      'finalScore', r.final_score, 'pointImpact', r.point_impact, 'doctorPointsImpact', r.doctor_points_impact,
      'ledgerTransactions', (select count(*) from public.employee_transactions t where t.source_id = r.id),
      'ledgerEvents', (select count(*) from public.employee_events e where e.source_id = r.id::text),
      'managerReviewed', r.manager_reviewed_at is not null,
      'effect', case when lower(btrim(coalesce(r.evaluation_kind,''))) = 'automatic' and r.is_current
                     then 'deactivate' else 'unchanged' end)
      order by r.id), '[]'::jsonb)
    into v_reviews
  from public.conversation_sales_reviews r
  where r.sales_intelligence_case_id = any(v_case_ids)
     or (p_scope = 'conversation' and r.whatsapp_review_source_id = p_source_id);

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'type', a.action_type, 'status', a.status, 'workStatus', a.work_status,
      'caseId', a.payload->>'caseId', 'targetTable', a.target_table,
      'recoveredInvoiceNumber', a.recovered_invoice_number, 'recoveredInvoiceValue', a.recovered_invoice_value,
      'effect', case
        when a.recovered_invoice_id is not null or a.recovered_at is not null then 'blocks_financial'
        when a.status = 'created' or a.target_table is not null or a.target_id is not null
          or a.assigned_at is not null or coalesce(a.work_status,'unassigned') <> 'unassigned'
          or a.started_at is not null or a.completed_at is not null
          or a.outcome is not null or a.outcome_note is not null
          or coalesce(a.followup_attempts,0) > 0 or a.last_followup_at is not null
          or (a.action_type = 'customer_request' and coalesce(a.auto_eligible,false)) then 'blocks_work'
        when a.status in ('proposed','ready','error') then 'withdraw'
        else 'unchanged' end)
      order by a.created_at, a.id), '[]'::jsonb)
    into v_actions
  from public.whatsapp_conversation_actions a
  where a.source_id = p_source_id
    and (p_scope = 'conversation' or a.payload->>'caseId' = any(v_case_ids));

  if p_scope = 'case' then
    select count(*) into v_unscoped_actions
    from public.whatsapp_conversation_actions a
    where a.source_id = p_source_id and nullif(btrim(coalesce(a.payload->>'caseId','')),'') is null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', a.id, 'caseId', a.case_id, 'level', a.attribution_level,
      'invoiceId', a.selected_invoice_id, 'invoiceNumber', a.selected_invoice_number,
      'official', a.is_official_for_staff_evaluation)
      order by a.case_id, a.id), '[]'::jsonb)
    into v_attributions
  from public.sales_intelligence_attributions a
  where a.case_id = any(v_case_ids) and a.is_current_evaluation;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', w.id, 'rootSourceId', w.root_source_id,
      'proofState', w.case_json #>> '{canonicalSaleProof,state}',
      'proofOwnerCaseId', nullif(btrim(coalesce(w.case_json #>> '{canonicalSaleProof,salesCaseId}','')),''),
      'verifiedInvoiceNumber', w.verified_invoice_number, 'verifiedRevenue', w.verified_revenue,
      'confirmedOutcome', w.confirmed_outcome, 'proposedOutcome', w.proposed_outcome)
      order by w.id), '[]'::jsonb)
    into v_envelopes
  from public.whatsapp_customer_cases_v22 w
  where w.root_source_id = p_source_id
     or p_source_id = any(coalesce(w.source_ids, '{}'::uuid[]))
     or w.id::text in (select c.source_case_id_v22 from public.sales_intelligence_cases c
                       where c.case_id = any(v_case_ids));

  -- Blockers: never decided by the UI; each one stops the command before any write.
  select v_blockers || coalesce(jsonb_agg(b order by b->>'code', b->>'ref'), '[]'::jsonb) into v_blockers
  from (
    select jsonb_build_object('code','canonical_sale_proof_in_scope','ref',e->>'id',
             'invoiceNumber',e->>'verifiedInvoiceNumber','revenue',e->'verifiedRevenue') b
    from jsonb_array_elements(v_envelopes) e
    where e->>'proofState' = 'proven'
      and ((e->>'proofOwnerCaseId') = any(v_case_ids)
           or (p_scope = 'conversation' and (e->>'rootSourceId')::uuid = p_source_id))
    union all
    select jsonb_build_object('code','canonical_sale_proof_owner_unknown','ref',e->>'id')
    from jsonb_array_elements(v_envelopes) e
    where e->>'proofState' = 'proven' and e->>'proofOwnerCaseId' is null
    union all
    select jsonb_build_object('code','verified_revenue_in_scope','ref',e->>'id',
             'invoiceNumber',e->>'verifiedInvoiceNumber','revenue',e->'verifiedRevenue')
    from jsonb_array_elements(v_envelopes) e
    where coalesce(e->>'proofState','') <> 'proven'
      and (nullif(e->>'verifiedInvoiceNumber','') is not null or coalesce((e->>'verifiedRevenue')::numeric,0) <> 0)
      and ((e->>'proofOwnerCaseId') = any(v_case_ids)
           or (p_scope = 'conversation' and (e->>'rootSourceId')::uuid = p_source_id))
    union all
    select jsonb_build_object('code','proven_invoice_attribution','ref',x->>'caseId','invoiceNumber',x->>'invoiceNumber')
    from jsonb_array_elements(v_attributions) x
    where x->>'level' = 'proven' or coalesce((x->>'official')::boolean,false)
    union all
    select jsonb_build_object('code','canonical_sale_proven','ref',x->>'caseId')
    from jsonb_array_elements(v_cases) x
    where x->>'salesOutcome' = 'sale_proven' or x->>'saleProofState' = 'proven'
    union all
    select jsonb_build_object('code','evaluation_has_points_or_incentive','ref',x->>'id',
             'pointImpact',x->'pointImpact','doctorPointsImpact',x->'doctorPointsImpact')
    from jsonb_array_elements(v_reviews) x
    where coalesce((x->>'pointImpact')::numeric,0) <> 0 or coalesce((x->>'doctorPointsImpact')::numeric,0) <> 0
       or (x->>'ledgerTransactions')::int > 0 or (x->>'ledgerEvents')::int > 0
    union all
    select jsonb_build_object('code','human_evaluation_in_scope','ref',x->>'id')
    from jsonb_array_elements(v_reviews) x
    where (coalesce((x->>'isCurrent')::boolean,false) and lower(btrim(coalesce(x->>'kind',''))) <> 'automatic')
       or coalesce((x->>'managerReviewed')::boolean,false)
    union all
    select jsonb_build_object('code','action_has_recovered_invoice','ref',x->>'id','invoiceNumber',x->>'recoveredInvoiceNumber')
    from jsonb_array_elements(v_actions) x where x->>'effect' = 'blocks_financial'
    union all
    select jsonb_build_object('code','action_has_human_or_executed_work','ref',x->>'id')
    from jsonb_array_elements(v_actions) x where x->>'effect' = 'blocks_work'
    union all
    select jsonb_build_object('code','conversation_has_invoice_link','ref',v_source.id::text,
             'invoiceNumber',coalesce(v_source.invoice_link_confirmed_invoice_number, v_source.matched_invoice_number))
    where p_scope = 'conversation'
      and (coalesce(v_source.invoice_link_confirmed,false) or v_source.invoice_link_confirmed_invoice_id is not null
           or v_source.matched_invoice_id is not null)
    union all
    select jsonb_build_object('code','conversation_has_human_confirmation','ref',v_source.id::text)
    where p_scope = 'conversation'
      and (coalesce(v_source.reviewer_confirmed,false) or v_source.official_review_id is not null)
    union all
    select jsonb_build_object('code','case_invoice_linked_to_conversation','ref',x->>'caseId','invoiceNumber',x->>'invoiceNumber')
    from jsonb_array_elements(v_attributions) x
    where p_scope = 'case' and x->>'invoiceId' is not null
      and (x->>'invoiceId' = v_source.invoice_link_confirmed_invoice_id
           or x->>'invoiceId' = v_source.matched_invoice_id::text)
  ) blockers;

  v_body := jsonb_build_object(
    'scope', p_scope, 'sourceId', p_source_id, 'caseIds', to_jsonb(v_case_ids),
    'conversation', v_conversation, 'cases', v_cases, 'remainingCases', v_siblings,
    'evaluations', v_reviews, 'actions', v_actions, 'unscopedActionsUnchanged', v_unscoped_actions,
    'attributions', v_attributions, 'v22Envelopes', v_envelopes, 'blockers', v_blockers);
  return v_body || jsonb_build_object('fingerprint', md5(v_body::text), 'blocked', jsonb_array_length(v_blockers) > 0);
end;
$function$;

revoke all on function public.dawaa_whatsapp_deletion_command_active_v1() from public, anon, authenticated;
revoke all on function public.dawaa_whatsapp_source_is_deleted_v1(uuid) from public, anon, authenticated;
revoke all on function public.dawaa_whatsapp_case_is_deleted_v1(text) from public, anon, authenticated;
revoke all on function public.dawaa_whatsapp_deletion_actor_v1() from public, anon, authenticated;
revoke all on function public.dawaa_whatsapp_deletion_impact_v1(uuid,text,text[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------
-- Revival guards. They apply to every role (the refresh runs privileged); only the delete/restore
-- commands, inside their own transaction, may change deletion state.
-- ---------------------------------------------------------------------------------------------

create or replace function public.dawaa_guard_whatsapp_source_deletion_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is not null or new.deletion_id is not null then
      raise exception 'whatsapp_deletion_requires_command' using errcode = '42501';
    end if;
    -- Re-uploading the export of a deleted conversation never creates a second, live copy.
    if exists(select 1 from public.whatsapp_review_sources s
              where s.source_hash = new.source_hash and s.deleted_at is not null) then
      raise exception 'whatsapp_source_deleted_restore_required';
    end if;
    return new;
  end if;
  if (new.deleted_at is distinct from old.deleted_at or new.deletion_id is distinct from old.deletion_id)
     and not public.dawaa_whatsapp_deletion_command_active_v1() then
    raise exception 'whatsapp_deletion_requires_command' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists whatsapp_source_deletion_guard_v1 on public.whatsapp_review_sources;
create trigger whatsapp_source_deletion_guard_v1
before insert or update on public.whatsapp_review_sources
for each row execute function public.dawaa_guard_whatsapp_source_deletion_v1();

create or replace function public.dawaa_guard_whatsapp_case_deletion_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if tg_op = 'INSERT' then
    if new.deleted_at is not null or new.deletion_id is not null then
      raise exception 'whatsapp_deletion_requires_command' using errcode = '42501';
    end if;
    if public.dawaa_whatsapp_source_is_deleted_v1(new.conversation_id) then
      raise exception 'whatsapp_scope_deleted_restore_required';
    end if;
    return new;
  end if;
  if (new.deleted_at is distinct from old.deleted_at or new.deletion_id is distinct from old.deletion_id)
     and not public.dawaa_whatsapp_deletion_command_active_v1() then
    raise exception 'whatsapp_deletion_requires_command' using errcode = '42501';
  end if;
  -- Still deleted after this write: lifecycle stays exactly as the deletion left it. Identity
  -- pointers and last_seen_at (re-analysis bookkeeping) may still change.
  if old.deleted_at is not null and new.deleted_at is not null then
    new.is_active := false;
    new.published_analysis_id := old.published_analysis_id;
    new.retired_at := old.retired_at;
    new.retire_reason := old.retire_reason;
    new.conversation_id := old.conversation_id;
  end if;
  return new;
end;
$function$;

drop trigger if exists whatsapp_case_deletion_guard_v1 on public.sales_intelligence_cases;
create trigger whatsapp_case_deletion_guard_v1
before insert or update on public.sales_intelligence_cases
for each row execute function public.dawaa_guard_whatsapp_case_deletion_v1();

create or replace function public.dawaa_guard_whatsapp_deleted_case_analysis_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if coalesce(new.is_current,false) and not public.dawaa_whatsapp_deletion_command_active_v1()
     and public.dawaa_whatsapp_case_is_deleted_v1(new.case_id) then
    new.is_current := false;
  end if;
  return new;
end;
$function$;

drop trigger if exists whatsapp_deleted_case_analysis_guard_v1 on public.sales_intelligence_case_analyses;
create trigger whatsapp_deleted_case_analysis_guard_v1
before insert or update of is_current on public.sales_intelligence_case_analyses
for each row execute function public.dawaa_guard_whatsapp_deleted_case_analysis_v1();

create or replace function public.dawaa_guard_whatsapp_deleted_scope_review_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if not coalesce(new.is_current,false) or public.dawaa_whatsapp_deletion_command_active_v1() then
    return new;
  end if;
  if (new.sales_intelligence_case_id is not null and public.dawaa_whatsapp_case_is_deleted_v1(new.sales_intelligence_case_id))
     or (new.whatsapp_review_source_id is not null and public.dawaa_whatsapp_source_is_deleted_v1(new.whatsapp_review_source_id)) then
    if lower(btrim(coalesce(new.evaluation_kind,''))) = 'automatic' then
      -- The automatic follower may still write its row; it never becomes an active evaluation.
      new.is_current := false;
      new.superseded_at := coalesce(new.superseded_at, now());
      new.superseded_reason := coalesce(new.superseded_reason, 'whatsapp_scope_deleted');
    else
      raise exception 'whatsapp_scope_deleted_restore_required';
    end if;
  end if;
  return new;
end;
$function$;

drop trigger if exists whatsapp_deleted_scope_review_guard_v1 on public.conversation_sales_reviews;
create trigger whatsapp_deleted_scope_review_guard_v1
before insert or update on public.conversation_sales_reviews
for each row execute function public.dawaa_guard_whatsapp_deleted_scope_review_v1();

create or replace function public.dawaa_guard_whatsapp_deleted_scope_action_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if public.dawaa_whatsapp_deletion_command_active_v1() then return new; end if;
  if not (public.dawaa_whatsapp_source_is_deleted_v1(new.source_id)
          or (nullif(btrim(coalesce(new.payload->>'caseId','')),'') is not null
              and public.dawaa_whatsapp_case_is_deleted_v1(new.payload->>'caseId'))) then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'whatsapp_scope_deleted_restore_required';
  end if;
  if new.status in ('proposed','ready','error') and new.status is distinct from old.status then
    raise exception 'whatsapp_scope_deleted_restore_required';
  end if;
  return new;
end;
$function$;

drop trigger if exists whatsapp_deleted_scope_action_guard_v1 on public.whatsapp_conversation_actions;
create trigger whatsapp_deleted_scope_action_guard_v1
before insert or update on public.whatsapp_conversation_actions
for each row execute function public.dawaa_guard_whatsapp_deleted_scope_action_v1();

revoke all on function public.dawaa_guard_whatsapp_source_deletion_v1() from public, anon, authenticated;
revoke all on function public.dawaa_guard_whatsapp_case_deletion_v1() from public, anon, authenticated;
revoke all on function public.dawaa_guard_whatsapp_deleted_case_analysis_v1() from public, anon, authenticated;
revoke all on function public.dawaa_guard_whatsapp_deleted_scope_review_v1() from public, anon, authenticated;
revoke all on function public.dawaa_guard_whatsapp_deleted_scope_action_v1() from public, anon, authenticated;

-- A deleted conversation is invisible to every client reader (queues, panels, reports). Its
-- actions, V22 envelopes and audit rows are readable only through an EXISTS on this table, so
-- they leave client lists too. Privileged (service_role) maintenance still sees it; the trash and
-- the delete/restore commands read through SECURITY DEFINER functions.
drop policy if exists whatsapp_review_sources_not_deleted_v1 on public.whatsapp_review_sources;
create policy whatsapp_review_sources_not_deleted_v1 on public.whatsapp_review_sources
  as restrictive for all to public
  using (deleted_at is null) with check (deleted_at is null);

-- ---------------------------------------------------------------------------------------------
-- Commands
-- ---------------------------------------------------------------------------------------------

create or replace function public.dawaa_preview_whatsapp_deletion_v1(p_scope text, p_target text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_source_id uuid;
  v_case public.sales_intelligence_cases%rowtype;
  v_case_ids text[];
begin
  perform 1 from public.dawaa_whatsapp_deletion_actor_v1();
  if p_scope = 'case' then
    select * into v_case from public.sales_intelligence_cases where case_id = p_target;
    if not found then raise exception 'whatsapp_case_not_found'; end if;
    if v_case.deleted_at is not null then
      return jsonb_build_object('ok', true, 'status', 'already_deleted', 'deletionId', v_case.deletion_id);
    end if;
    if public.dawaa_whatsapp_source_is_deleted_v1(v_case.conversation_id) then
      return jsonb_build_object('ok', true, 'status', 'conversation_deleted');
    end if;
    v_source_id := v_case.conversation_id;
    v_case_ids := array[p_target];
  elsif p_scope = 'conversation' then
    begin
      v_source_id := p_target::uuid;
    exception when invalid_text_representation then
      raise exception 'whatsapp_source_not_found';
    end;
    if public.dawaa_whatsapp_source_is_deleted_v1(v_source_id) then
      return jsonb_build_object('ok', true, 'status', 'already_deleted',
        'deletionId', (select deletion_id from public.whatsapp_review_sources where id = v_source_id));
    end if;
    select coalesce(array_agg(c.case_id order by c.case_id), '{}'::text[]) into v_case_ids
    from public.sales_intelligence_cases c
    where c.conversation_id = v_source_id and c.deleted_at is null;
  else
    raise exception 'whatsapp_deletion_scope_invalid';
  end if;
  return jsonb_build_object('ok', true, 'status', 'preview')
    || public.dawaa_whatsapp_deletion_impact_v1(v_source_id, p_scope, v_case_ids);
end;
$function$;

create or replace function public.dawaa_whatsapp_delete_scope_core_v1(
  p_scope text, p_target text, p_reason text, p_expected_fingerprint text, p_request_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor record;
  v_reason text := btrim(coalesce(p_reason,''));
  v_source_id uuid;
  v_source public.whatsapp_review_sources%rowtype;
  v_case public.sales_intelligence_cases%rowtype;
  v_lock record;
  v_existing public.whatsapp_conversation_deletions%rowtype;
  v_case_ids text[];
  v_impact jsonb;
  v_deletion_id uuid := gen_random_uuid();
  v_audit_id uuid := gen_random_uuid();
  v_prior jsonb;
  v_review_ids uuid[];
  v_action_ids uuid[];
  v_analysis_ids uuid[];
begin
  select * into v_actor from public.dawaa_whatsapp_deletion_actor_v1();
  if char_length(v_reason) < 10 then raise exception 'whatsapp_deletion_reason_required'; end if;
  if coalesce(p_request_key,'') !~ '^[A-Za-z0-9:_-]{8,120}$' then
    raise exception 'whatsapp_deletion_request_key_invalid';
  end if;

  if p_scope = 'case' then
    select conversation_id into v_source_id from public.sales_intelligence_cases where case_id = p_target;
    if not found then raise exception 'whatsapp_case_not_found'; end if;
  else
    begin
      v_source_id := p_target::uuid;
    exception when invalid_text_representation then
      raise exception 'whatsapp_source_not_found';
    end;
  end if;

  -- Lock order shared with sales_intelligence_reconcile_case_set_v2 and the attribution correction.
  select * into v_source from public.whatsapp_review_sources where id = v_source_id for update;
  if not found then raise exception 'whatsapp_source_not_found'; end if;
  perform pg_advisory_xact_lock(hashtext('sales_intelligence_case_set:' || v_source_id::text));
  for v_lock in select case_id from public.sales_intelligence_cases
    where conversation_id = v_source_id order by case_id
  loop
    perform pg_advisory_xact_lock(hashtext('sales_intelligence_case_analyses:' || v_lock.case_id));
  end loop;

  -- Double click / retry: the same request key returns the first result, never a second deletion.
  select * into v_existing from public.whatsapp_conversation_deletions where request_key = p_request_key;
  if found then
    if v_existing.scope <> p_scope or v_existing.source_id <> v_source_id
       or (p_scope = 'case' and v_existing.case_ids <> array[p_target]) then
      raise exception 'whatsapp_deletion_request_key_conflict';
    end if;
    return jsonb_build_object('ok', true, 'changed', false, 'status', 'replayed',
      'deletionId', v_existing.id, 'auditId', v_existing.delete_audit_id, 'deletionStatus', v_existing.status);
  end if;

  if p_scope = 'case' then
    select * into v_case from public.sales_intelligence_cases where case_id = p_target;
    if v_case.deleted_at is not null then
      return jsonb_build_object('ok', true, 'changed', false, 'status', 'already_deleted', 'deletionId', v_case.deletion_id);
    end if;
    if v_source.deleted_at is not null then raise exception 'whatsapp_conversation_already_deleted'; end if;
    v_case_ids := array[p_target];
  else
    if v_source.deleted_at is not null then
      return jsonb_build_object('ok', true, 'changed', false, 'status', 'already_deleted', 'deletionId', v_source.deletion_id);
    end if;
    select coalesce(array_agg(c.case_id order by c.case_id), '{}'::text[]) into v_case_ids
    from public.sales_intelligence_cases c
    where c.conversation_id = v_source_id and c.deleted_at is null;
  end if;

  v_impact := public.dawaa_whatsapp_deletion_impact_v1(v_source_id, p_scope, v_case_ids);
  if coalesce((v_impact->>'blocked')::boolean, true) then
    return jsonb_build_object('ok', false, 'changed', false, 'status', 'blocked',
      'blockers', v_impact->'blockers', 'impact', v_impact);
  end if;
  if v_impact->>'fingerprint' is distinct from p_expected_fingerprint then
    raise exception 'whatsapp_deletion_preview_stale';
  end if;

  select coalesce(array_agg((x->>'id')::uuid order by x->>'id'), '{}'::uuid[]) into v_review_ids
  from jsonb_array_elements(v_impact->'evaluations') x where x->>'effect' = 'deactivate';
  select coalesce(array_agg((x->>'id')::uuid order by x->>'id'), '{}'::uuid[]) into v_action_ids
  from jsonb_array_elements(v_impact->'actions') x where x->>'effect' = 'withdraw';
  select coalesce(array_agg(a.analysis_id order by a.analysis_id), '{}'::uuid[]) into v_analysis_ids
  from public.sales_intelligence_case_analyses a where a.case_id = any(v_case_ids) and a.is_current;

  v_prior := jsonb_build_object(
    'source', jsonb_build_object('id', v_source.id, 'deletedAt', v_source.deleted_at),
    'cases', (select coalesce(jsonb_agg(jsonb_build_object('caseId', c.case_id, 'isActive', c.is_active,
                'publishedAnalysisId', c.published_analysis_id, 'retiredAt', c.retired_at,
                'retireReason', c.retire_reason) order by c.case_id), '[]'::jsonb)
              from public.sales_intelligence_cases c where c.case_id = any(v_case_ids)),
    'currentAnalyses', (select coalesce(jsonb_agg(jsonb_build_object('analysisId', a.analysis_id, 'caseId', a.case_id,
                'supersededAt', a.superseded_at, 'supersededBy', a.superseded_by_analysis_id) order by a.analysis_id), '[]'::jsonb)
              from public.sales_intelligence_case_analyses a where a.analysis_id = any(v_analysis_ids)),
    'evaluations', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'caseId', r.sales_intelligence_case_id,
                'supersededAt', r.superseded_at, 'supersededReason', r.superseded_reason) order by r.id), '[]'::jsonb)
              from public.conversation_sales_reviews r where r.id = any(v_review_ids)),
    'actions', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'status', a.status,
                'autoEligible', a.auto_eligible,
                'payloadKeys', jsonb_build_object(
                  'canonicalLifecycle', a.payload->'canonicalLifecycle',
                  'canonicalWithdrawalReason', a.payload->'canonicalWithdrawalReason',
                  'deletionId', a.payload->'deletionId')) order by a.id), '[]'::jsonb)
              from public.whatsapp_conversation_actions a where a.id = any(v_action_ids)));

  insert into public.whatsapp_conversation_deletions(id, scope, source_id, case_ids, reason, request_key,
    impact, impact_fingerprint, prior_state, deleted_by, deleted_by_name, deleted_by_role, delete_audit_id)
  values (v_deletion_id, p_scope, v_source_id, v_case_ids, v_reason, p_request_key,
    v_impact, v_impact->>'fingerprint', v_prior, v_actor.actor_id, v_actor.actor_name, v_actor.actor_role, v_audit_id);

  perform set_config('dawaa.whatsapp_deletion_command', v_deletion_id::text, true);

  update public.sales_intelligence_cases set
    is_active = false,
    retired_at = now(),
    retire_reason = 'deleted_by_general_manager',
    deleted_at = now(),
    deletion_id = v_deletion_id
  where case_id = any(v_case_ids);

  update public.sales_intelligence_case_analyses set is_current = false, superseded_at = coalesce(superseded_at, now())
  where analysis_id = any(v_analysis_ids);

  update public.conversation_sales_reviews set
    is_current = false, superseded_at = now(), superseded_reason = 'deleted_by_general_manager', updated_at = now()
  where id = any(v_review_ids);

  update public.whatsapp_conversation_actions a set
    status = 'dismissed',
    auto_eligible = false,
    payload = coalesce(a.payload,'{}'::jsonb) || jsonb_build_object(
      'canonicalLifecycle', 'withdrawn',
      'canonicalWithdrawalReason', 'deleted_by_general_manager',
      'deletionId', v_deletion_id::text),
    updated_at = now()
  where a.id = any(v_action_ids);

  if p_scope = 'conversation' then
    update public.whatsapp_review_sources set deleted_at = now(), deletion_id = v_deletion_id
    where id = v_source_id;
  end if;

  -- Same transaction: an audit failure aborts the deletion.
  insert into public.whatsapp_review_audit(id, source_id, action, actor_id, actor_name, actor_role,
    before_state, after_state, note)
  values (v_audit_id, v_source_id,
    case when p_scope = 'case' then 'whatsapp_case_soft_deleted_v1' else 'whatsapp_conversation_soft_deleted_v1' end,
    v_actor.actor_id::text, v_actor.actor_name, v_actor.actor_role,
    v_prior,
    jsonb_build_object('deletionId', v_deletion_id, 'scope', p_scope, 'sourceId', v_source_id,
      'caseIds', to_jsonb(v_case_ids), 'deactivatedAnalysisIds', to_jsonb(v_analysis_ids),
      'deactivatedEvaluationIds', to_jsonb(v_review_ids), 'withdrawnActionIds', to_jsonb(v_action_ids),
      'sourceDeleted', p_scope = 'conversation', 'impactFingerprint', v_impact->>'fingerprint',
      'requestKey', p_request_key,
      'untouched', jsonb_build_array('customer','sales_invoices','sales_invoice_items','v22_revenue_ledger',
        'sale_proof','employee_points','audit_log')),
    v_reason);

  perform set_config('dawaa.whatsapp_deletion_command', '', true);

  return jsonb_build_object('ok', true, 'changed', true, 'status', 'deleted', 'deletionId', v_deletion_id,
    'auditId', v_audit_id, 'scope', p_scope, 'sourceId', v_source_id, 'caseIds', to_jsonb(v_case_ids),
    'deactivatedEvaluations', cardinality(v_review_ids), 'withdrawnActions', cardinality(v_action_ids));
end;
$function$;

revoke all on function public.dawaa_whatsapp_delete_scope_core_v1(text,text,text,text,text) from public, anon, authenticated;

create or replace function public.dawaa_delete_whatsapp_case_v1(
  p_case_id text, p_reason text, p_confirmation text, p_expected_fingerprint text, p_request_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  perform 1 from public.dawaa_whatsapp_deletion_actor_v1();
  if btrim(coalesce(p_confirmation,'')) <> 'حذف الحالة' then
    raise exception 'whatsapp_case_deletion_confirmation_required';
  end if;
  return public.dawaa_whatsapp_delete_scope_core_v1('case', p_case_id, p_reason, p_expected_fingerprint, p_request_key);
end;
$function$;

create or replace function public.dawaa_delete_whatsapp_conversation_v1(
  p_source_id uuid, p_reason text, p_confirmation text, p_expected_fingerprint text, p_request_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  perform 1 from public.dawaa_whatsapp_deletion_actor_v1();
  if btrim(coalesce(p_confirmation,'')) <> 'حذف المحادثة وكل حالاتها' then
    raise exception 'whatsapp_conversation_deletion_confirmation_required';
  end if;
  return public.dawaa_whatsapp_delete_scope_core_v1('conversation', p_source_id::text, p_reason, p_expected_fingerprint, p_request_key);
end;
$function$;

create or replace function public.dawaa_restore_whatsapp_deletion_v1(
  p_deletion_id uuid, p_reason text, p_confirmation text, p_request_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor record;
  v_reason text := btrim(coalesce(p_reason,''));
  v_deletion public.whatsapp_conversation_deletions%rowtype;
  v_source public.whatsapp_review_sources%rowtype;
  v_lock record;
  v_audit_id uuid := gen_random_uuid();
  v_blockers jsonb;
  v_restored_reviews uuid[];
  v_skipped_reviews uuid[];
  v_restored_actions uuid[];
  v_skipped_actions uuid[];
  v_restored_analyses uuid[];
  v_result jsonb;
begin
  select * into v_actor from public.dawaa_whatsapp_deletion_actor_v1();
  if btrim(coalesce(p_confirmation,'')) <> 'استرجاع' then
    raise exception 'whatsapp_restore_confirmation_required';
  end if;
  if char_length(v_reason) < 10 then raise exception 'whatsapp_restore_reason_required'; end if;
  if coalesce(p_request_key,'') !~ '^[A-Za-z0-9:_-]{8,120}$' then
    raise exception 'whatsapp_deletion_request_key_invalid';
  end if;

  select * into v_deletion from public.whatsapp_conversation_deletions where id = p_deletion_id;
  if not found then raise exception 'whatsapp_deletion_not_found'; end if;

  select * into v_source from public.whatsapp_review_sources where id = v_deletion.source_id for update;
  perform pg_advisory_xact_lock(hashtext('sales_intelligence_case_set:' || v_deletion.source_id::text));
  for v_lock in select case_id from public.sales_intelligence_cases
    where conversation_id = v_deletion.source_id order by case_id
  loop
    perform pg_advisory_xact_lock(hashtext('sales_intelligence_case_analyses:' || v_lock.case_id));
  end loop;
  select * into v_deletion from public.whatsapp_conversation_deletions where id = p_deletion_id for update;

  if v_deletion.status = 'restored' then
    return jsonb_build_object('ok', true, 'changed', false,
      'status', case when v_deletion.restore_request_key = p_request_key then 'replayed' else 'already_restored' end,
      'deletionId', v_deletion.id, 'auditId', v_deletion.restore_audit_id);
  end if;
  if exists(select 1 from public.whatsapp_conversation_deletions d where d.restore_request_key = p_request_key) then
    raise exception 'whatsapp_deletion_request_key_conflict';
  end if;
  if v_deletion.scope = 'case' and v_source.deleted_at is not null then
    raise exception 'whatsapp_restore_conversation_first';
  end if;

  -- Restoring a current automatic case evaluation re-runs the legacy supersede follower, which
  -- would retire a conversation-level evaluation written after the deletion. Stop and show it.
  select coalesce(jsonb_agg(jsonb_build_object('code','restore_would_supersede_conversation_evaluation','ref',r.id)
           order by r.id), '[]'::jsonb)
    into v_blockers
  from public.conversation_sales_reviews r
  where r.whatsapp_review_source_id = v_deletion.source_id
    and r.sales_intelligence_case_id is null and r.is_current
    and exists(select 1 from jsonb_array_elements(v_deletion.prior_state->'evaluations') e
               where e->>'caseId' is not null);
  if jsonb_array_length(v_blockers) > 0 then
    return jsonb_build_object('ok', false, 'changed', false, 'status', 'blocked', 'blockers', v_blockers);
  end if;

  perform set_config('dawaa.whatsapp_deletion_command', v_deletion.id::text, true);

  if v_deletion.scope = 'conversation' then
    update public.whatsapp_review_sources set deleted_at = null, deletion_id = null
    where id = v_deletion.source_id and deletion_id = v_deletion.id;
  end if;

  -- Analyses: only when the case has no other current analysis (never two current analyses).
  with restored as (
    update public.sales_intelligence_case_analyses a set
      is_current = true,
      superseded_at = (p->>'supersededAt')::timestamptz,
      superseded_by_analysis_id = (p->>'supersededBy')::uuid
    from jsonb_array_elements(v_deletion.prior_state->'currentAnalyses') p
    where a.analysis_id = (p->>'analysisId')::uuid and not a.is_current
      and not exists(select 1 from public.sales_intelligence_case_analyses o
                     where o.case_id = a.case_id and o.is_current and o.analysis_id <> a.analysis_id)
    returning a.analysis_id)
  select coalesce(array_agg(analysis_id order by analysis_id), '{}'::uuid[]) into v_restored_analyses from restored;

  update public.sales_intelligence_cases c set
    is_active = coalesce((p->>'isActive')::boolean, false)
      and (p->>'publishedAnalysisId' is null or (p->>'publishedAnalysisId')::uuid = any(v_restored_analyses)
           or exists(select 1 from public.sales_intelligence_case_analyses a
                     where a.analysis_id = (p->>'publishedAnalysisId')::uuid and a.is_current)),
    published_analysis_id = (p->>'publishedAnalysisId')::uuid,
    retired_at = (p->>'retiredAt')::timestamptz,
    retire_reason = p->>'retireReason',
    deleted_at = null,
    deletion_id = null
  from jsonb_array_elements(v_deletion.prior_state->'cases') p
  where c.case_id = p->>'caseId' and c.deletion_id = v_deletion.id;

  -- Evaluations: the same rows become current again, unless the case already has a current
  -- automatic evaluation (never two active evaluations for one case).
  with restored as (
    update public.conversation_sales_reviews r set
      is_current = true,
      superseded_at = (p->>'supersededAt')::timestamptz,
      superseded_reason = p->>'supersededReason',
      updated_at = now()
    from jsonb_array_elements(v_deletion.prior_state->'evaluations') p
    where r.id = (p->>'id')::uuid and not r.is_current
      and r.superseded_reason = 'deleted_by_general_manager'
      and not exists(select 1 from public.conversation_sales_reviews o
                     where o.id <> r.id and o.is_current
                       and lower(btrim(coalesce(o.evaluation_kind,''))) = 'automatic'
                       and o.sales_intelligence_case_id is not distinct from r.sales_intelligence_case_id
                       and o.whatsapp_review_source_id is not distinct from r.whatsapp_review_source_id)
    returning r.id)
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_restored_reviews from restored;
  select coalesce(array_agg((p->>'id')::uuid order by p->>'id'), '{}'::uuid[]) into v_skipped_reviews
  from jsonb_array_elements(v_deletion.prior_state->'evaluations') p
  where not ((p->>'id')::uuid = any(v_restored_reviews));

  -- Actions: only rows this deletion withdrew and nobody touched since (same rows, same keys).
  with restored as (
    update public.whatsapp_conversation_actions a set
      status = p->>'status',
      auto_eligible = coalesce((p->>'autoEligible')::boolean, false),
      payload = (a.payload - array['canonicalLifecycle','canonicalWithdrawalReason','deletionId'])
        || jsonb_strip_nulls(p->'payloadKeys'),
      updated_at = now()
    from jsonb_array_elements(v_deletion.prior_state->'actions') p
    where a.id = (p->>'id')::uuid and a.status = 'dismissed' and a.payload->>'deletionId' = v_deletion.id::text
    returning a.id)
  select coalesce(array_agg(id order by id), '{}'::uuid[]) into v_restored_actions from restored;
  select coalesce(array_agg((p->>'id')::uuid order by p->>'id'), '{}'::uuid[]) into v_skipped_actions
  from jsonb_array_elements(v_deletion.prior_state->'actions') p
  where not ((p->>'id')::uuid = any(v_restored_actions));

  v_result := jsonb_build_object('restoredAnalysisIds', to_jsonb(v_restored_analyses),
    'restoredEvaluationIds', to_jsonb(v_restored_reviews), 'skippedEvaluationIds', to_jsonb(v_skipped_reviews),
    'restoredActionIds', to_jsonb(v_restored_actions), 'skippedActionIds', to_jsonb(v_skipped_actions),
    'reanalysis', 'required_explicit_refresh');

  update public.whatsapp_conversation_deletions set
    status = 'restored', restore_request_key = p_request_key, restore_reason = v_reason,
    restored_by = v_actor.actor_id, restored_by_name = v_actor.actor_name, restored_at = now(),
    restore_audit_id = v_audit_id, restore_result = v_result
  where id = v_deletion.id;

  insert into public.whatsapp_review_audit(id, source_id, action, actor_id, actor_name, actor_role,
    before_state, after_state, note)
  values (v_audit_id, v_deletion.source_id,
    case when v_deletion.scope = 'case' then 'whatsapp_case_restored_v1' else 'whatsapp_conversation_restored_v1' end,
    v_actor.actor_id::text, v_actor.actor_name, v_actor.actor_role,
    jsonb_build_object('deletionId', v_deletion.id, 'scope', v_deletion.scope, 'caseIds', to_jsonb(v_deletion.case_ids),
      'deletedAt', v_deletion.deleted_at, 'deleteAuditId', v_deletion.delete_audit_id),
    v_result || jsonb_build_object('deletionId', v_deletion.id, 'requestKey', p_request_key),
    v_reason);

  perform set_config('dawaa.whatsapp_deletion_command', '', true);

  return jsonb_build_object('ok', true, 'changed', true, 'status', 'restored', 'deletionId', v_deletion.id,
    'auditId', v_audit_id) || v_result;
end;
$function$;

-- Trash: bounded, newest first, general manager only.
create or replace function public.dawaa_list_whatsapp_deletions_v1(
  p_status text default 'deleted', p_limit integer default 50, p_before timestamptz default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  perform 1 from public.dawaa_whatsapp_deletion_actor_v1();
  if p_status not in ('deleted','restored','all') then raise exception 'whatsapp_deletion_status_invalid'; end if;
  return (
    select coalesce(jsonb_agg(item order by (item->>'deletedAt')::timestamptz desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
        'id', d.id, 'scope', d.scope, 'status', d.status, 'sourceId', d.source_id, 'caseIds', to_jsonb(d.case_ids),
        'reason', d.reason, 'deletedBy', d.deleted_by_name, 'deletedAt', d.deleted_at,
        'restoredBy', d.restored_by_name, 'restoredAt', d.restored_at, 'restoreReason', d.restore_reason,
        'customerName', s.customer_name, 'customerCode', s.customer_code, 'branch', s.branch,
        'staffName', s.staff_name, 'conversationStartedAt', s.conversation_started_at,
        'evaluations', jsonb_array_length(coalesce(d.prior_state->'evaluations','[]'::jsonb)),
        'actions', jsonb_array_length(coalesce(d.prior_state->'actions','[]'::jsonb)),
        'restorable', d.status = 'deleted' and (d.scope = 'conversation' or s.deleted_at is null)) as item
      from public.whatsapp_conversation_deletions d
      join public.whatsapp_review_sources s on s.id = d.source_id
      where (p_status = 'all' or d.status = p_status)
        and (p_before is null or d.deleted_at < p_before)
      order by d.deleted_at desc
      limit greatest(1, least(coalesce(p_limit, 50), 100))
    ) page
  );
end;
$function$;

revoke all on function public.dawaa_preview_whatsapp_deletion_v1(text,text) from public;
revoke all on function public.dawaa_delete_whatsapp_case_v1(text,text,text,text,text) from public;
revoke all on function public.dawaa_delete_whatsapp_conversation_v1(uuid,text,text,text,text) from public;
revoke all on function public.dawaa_restore_whatsapp_deletion_v1(uuid,text,text,text) from public;
revoke all on function public.dawaa_list_whatsapp_deletions_v1(text,integer,timestamptz) from public;
-- Browser staff calls arrive as anon + x-dawaa-session-token; EXECUTE alone authorizes nothing:
-- every command resolves the strict staff session and requires an active general manager.
grant execute on function public.dawaa_preview_whatsapp_deletion_v1(text,text) to anon, authenticated, service_role;
grant execute on function public.dawaa_delete_whatsapp_case_v1(text,text,text,text,text) to anon, authenticated, service_role;
grant execute on function public.dawaa_delete_whatsapp_conversation_v1(uuid,text,text,text,text) to anon, authenticated, service_role;
grant execute on function public.dawaa_restore_whatsapp_deletion_v1(uuid,text,text,text) to anon, authenticated, service_role;
grant execute on function public.dawaa_list_whatsapp_deletions_v1(text,integer,timestamptz) to anon, authenticated, service_role;

comment on table public.whatsapp_conversation_deletions is
  'Trash of WhatsApp case/conversation soft deletions by a general manager. Rows are never deleted; restore is a new audited event on the same row.';

notify pgrst, 'reload schema';

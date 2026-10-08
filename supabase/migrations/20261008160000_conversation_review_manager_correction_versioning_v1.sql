-- Conversation review: manager full correction as a NEW VERSION (supersession), never an overwrite.
--
-- Root cause of "automatic_conversation_review_evidence_is_immutable_for_client":
-- Reviews.tsx saveEdit() sent a direct browser UPDATE of conversation_sales_reviews that rewrote
-- system-owned automatic evidence (raw_scores, review_items, scores, impact, criteria, staff and
-- customer identity). dawaa_guard_automatic_conversation_review_writer_v2 correctly rejects that:
-- automatic evidence is immutable for clients. The guard is kept and only strengthened here.
--
-- Contract (one staff-session command, one transaction):
--   1. The current version (an automatic review, or an earlier manager correction) is locked.
--   2. It becomes is_current=false with superseded_at/superseded_reason ('manager_correction: <reason>').
--      Nothing else on it changes; from then on it is frozen for every role (audit evidence).
--   3. A NEW row is inserted: evaluation_kind='manager_correction', correction_kind=
--      'manager_full_correction', supersedes_review_id -> the old version (explicit FK lineage),
--      the manager reason, the idempotency key, reviewer_* = the session-bound manager account,
--      the manager-approved criteria/score/review_items/impact, and the canonical provenance copied
--      from the old version (whatsapp_review_source_id, sales_intelligence_case_id,
--      automatic_evaluation_version/json, evidence coverage/reliability, customer, conversation date,
--      branch, month cycle). The new row is the only current row for that conversation/case.
--   4. Points: the superseded version's live review-linked ledger rows are cancelled (status only;
--      the payload stays frozen by protect_conversation_review_points_payload_v1) and the new
--      version's impact is posted once through the existing record_conversation_review_points_v1
--      bridge (source='conversation_evaluation', source_id=<new review id>). Staff reassignment is
--      therefore "reverse old staff once, apply new staff once". Any failure rolls back everything.
--   5. Idempotency: a retry with the same key returns the same correction and converges points
--      (never a second version). One correction per superseded row is enforced by a unique index.
--
-- Branch contract (two meanings, never mixed):
--   * conversation_sales_reviews.branch / branch_id of a correction = the canonical conversation/
--     source branch, copied from the superseded version and bound server-side. Reassigning the
--     responsible staff NEVER changes it, and the correction's points row is posted with that same
--     source branch (record_conversation_review_points_v1 passes p_branch = review.branch).
--   * the replacement staff member's own branch (staff.branch) is used ONLY as an authorization
--     scope check: the actor must be able to see that branch too. Cross-branch reassignment is
--     therefore supported for global roles and rejected (correction_staff_scope_denied) for a
--     branch-scoped manager whose scope does not include the new staff's branch.
--
-- No stale derived fields: every evaluation-derived top-level column (scores, totals, level, impact,
-- outcome flags, has_* / *_flag columns, review_items) is REQUIRED in the payload (a missing key is
-- rejected, never inherited from the superseded version) and must agree with the payload's own
-- raw_scores.criteria / severe_errors / result (correction_payload_inconsistent:<column>).
-- Columns copied from the superseded version are provenance/timing facts only (customer, invoice,
-- conversation date/type, branch, month cycle, first message/reply timings, follow-up delay,
-- repeat count/multiplier, base score, converted_to_sale, source/case ids, automatic evaluation
-- snapshot, evidence coverage/reliability, manual clinical review flag).
--
-- record_conversation_review_points_v1 (the existing Production review-points caller) is hardened
-- in place: its account-state check becomes fail-closed (NULL active/is_active/can_login/status
-- deny). Its signature, return contract, owner and grants are unchanged (create or replace).
--
-- Authentication follows record_conversation_review_points_v1 / Evidence V17 session command:
-- opaque staff session token -> sha256 -> live staff_login_sessions row -> fail-closed active
-- account. auth.uid(), request headers and x-dawaa-user-id never participate in the decision.

-- ---------------------------------------------------------------------------------------------
-- 1. Explicit lineage columns.
-- ---------------------------------------------------------------------------------------------
alter table public.conversation_sales_reviews
  add column if not exists supersedes_review_id uuid
    references public.conversation_sales_reviews(id) on delete restrict,
  add column if not exists correction_kind text,
  add column if not exists correction_reason text,
  add column if not exists correction_idempotency_key uuid;

alter table public.conversation_sales_reviews
  drop constraint if exists conversation_sales_reviews_correction_lineage_ck;
alter table public.conversation_sales_reviews
  add constraint conversation_sales_reviews_correction_lineage_ck check (
    (
      correction_kind is null
      and supersedes_review_id is null
      and correction_reason is null
      and correction_idempotency_key is null
      and lower(btrim(coalesce(evaluation_kind,''))) <> 'manager_correction'
    )
    or (
      correction_kind = 'manager_full_correction'
      and lower(btrim(coalesce(evaluation_kind,''))) = 'manager_correction'
      and supersedes_review_id is not null
      and supersedes_review_id <> id
      and nullif(btrim(coalesce(correction_reason,'')),'') is not null
      and correction_idempotency_key is not null
      and reviewer_id is not null
    )
  );

comment on column public.conversation_sales_reviews.supersedes_review_id is
  'Manager correction lineage: the review version this row replaced. The superseded row is kept, non-current and frozen.';
comment on column public.conversation_sales_reviews.correction_kind is
  'manager_full_correction for a manager correction version; NULL for original (automatic or human) reviews.';
comment on column public.conversation_sales_reviews.correction_reason is
  'Mandatory manager reason for the correction version.';
comment on column public.conversation_sales_reviews.correction_idempotency_key is
  'Client-generated key of one correction attempt; a retry with the same key returns the same version.';

-- One correction per superseded version (no forks), one row per idempotency key.
create unique index if not exists conversation_sales_reviews_supersedes_uk
  on public.conversation_sales_reviews (supersedes_review_id)
  where supersedes_review_id is not null;
create unique index if not exists conversation_sales_reviews_correction_key_uk
  on public.conversation_sales_reviews (correction_idempotency_key)
  where correction_idempotency_key is not null;

-- Original-evidence uniqueness stays exactly as before for original rows; correction versions share
-- the source/case provenance on purpose and are deduplicated by supersedes_review_id instead.
drop index if exists public.conversation_sales_reviews_whatsapp_case_uk;
create unique index conversation_sales_reviews_whatsapp_case_uk
  on public.conversation_sales_reviews (whatsapp_review_source_id, sales_intelligence_case_id)
  where whatsapp_review_source_id is not null
    and sales_intelligence_case_id is not null
    and supersedes_review_id is null;

drop index if exists public.conversation_sales_reviews_whatsapp_source_legacy_uk;
create unique index conversation_sales_reviews_whatsapp_source_legacy_uk
  on public.conversation_sales_reviews (whatsapp_review_source_id)
  where whatsapp_review_source_id is not null
    and sales_intelligence_case_id is null
    and supersedes_review_id is null;

drop index if exists public.idx_conversation_reviews_unique_submission;
create unique index idx_conversation_reviews_unique_submission
  on public.conversation_sales_reviews (staff_name, customer_name, conversation_date, reviewer_name)
  where conversation_date is not null
    and supersedes_review_id is null;

-- At most ONE current version per conversation case (original or correction).
create unique index if not exists conversation_sales_reviews_one_current_case_uk
  on public.conversation_sales_reviews (whatsapp_review_source_id, sales_intelligence_case_id)
  where is_current = true
    and whatsapp_review_source_id is not null
    and sales_intelligence_case_id is not null;
create unique index if not exists conversation_sales_reviews_one_current_legacy_source_uk
  on public.conversation_sales_reviews (whatsapp_review_source_id)
  where is_current = true
    and whatsapp_review_source_id is not null
    and sales_intelligence_case_id is null;

-- ---------------------------------------------------------------------------------------------
-- 2. Insert normalizers: a correction version carries the command-bound reviewer and its own
--    deterministic fingerprint. (Live bodies, plus one early branch each.)
-- ---------------------------------------------------------------------------------------------
create or replace function public.bind_conversation_review_reviewer_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor_id uuid;
  v_name text;
  v_role text;
begin
  if lower(trim(coalesce(new.evaluation_kind, ''))) = 'automatic' then
    new.reviewer_id := null;
    new.reviewer_name := null;
    new.reviewer_role := null;
    return new;
  end if;

  -- Correction versions are inserted only by dawaa_correct_conversation_review_session_v1, which
  -- binds reviewer_* to the validated staff session. The writer guard rejects any client insert
  -- carrying correction fields, so this branch is never reachable from a browser write.
  if new.correction_kind is not null then
    return new;
  end if;

  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null then
    raise exception 'identified_reviewer_required';
  end if;

  select sa.name, sa.role
    into v_name, v_role
  from public.staff_accounts sa
  where sa.id = v_actor_id
    and coalesce(sa.active, false)
    and coalesce(sa.can_login, false)
  limit 1;

  if v_name is null then
    raise exception 'active_reviewer_account_required';
  end if;

  new.reviewer_id := v_actor_id;
  new.reviewer_name := v_name;
  new.reviewer_role := v_role;
  return new;
end;
$function$;

create or replace function public.set_conversation_review_submission_fingerprint_v2()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_staff_key text;
  v_reviewer_key text;
  v_customer_key text;
  v_payload text;
begin
  -- A correction version is unique by the version it supersedes, not by staff/reviewer/date.
  if new.supersedes_review_id is not null then
    new.submission_fingerprint := 'manager-correction:' || new.supersedes_review_id::text;
    return new;
  end if;

  if new.conversation_date is null then
    new.submission_fingerprint := null;
    return new;
  end if;

  v_staff_key := coalesce(
    new.staff_id::text,
    nullif(lower(trim(coalesce(new.staff_name, ''))), ''),
    '__no_staff__'
  );
  v_reviewer_key := coalesce(
    new.reviewer_id::text,
    nullif(lower(trim(coalesce(new.reviewer_name, ''))), ''),
    '__no_reviewer__'
  );
  v_customer_key := coalesce(
    nullif(trim(coalesce(new.customer_code, '')), ''),
    nullif(trim(coalesce(new.customer_id, '')), ''),
    nullif(lower(trim(coalesce(new.customer_name, ''))), ''),
    '__no_customer__'
  );

  v_payload := concat_ws(
    '|',
    v_staff_key,
    v_reviewer_key,
    to_char(new.conversation_date at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'),
    v_customer_key
  );

  new.submission_fingerprint := encode(
    extensions.digest(convert_to(v_payload, 'UTF8'), 'sha256'::text),
    'hex'
  );
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- 3. Client writer guard (strengthened, never weakened). Automatic rows keep the exact V2 rule;
--    correction versions get the same rule, and clients can never create correction lineage.
-- ---------------------------------------------------------------------------------------------
create or replace function public.dawaa_guard_automatic_conversation_review_writer_v2()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog'
as $function$
declare
  v_privileged boolean := current_user in ('postgres','service_role','supabase_admin');
  v_old_system jsonb;
  v_new_system jsonb;
  v_new_versioned boolean;
begin
  if v_privileged then
    return new;
  end if;

  v_new_versioned := new.correction_kind is not null
    or new.supersedes_review_id is not null
    or new.correction_reason is not null
    or new.correction_idempotency_key is not null
    or lower(trim(coalesce(new.evaluation_kind,'')))='manager_correction';

  if tg_op='INSERT' then
    if lower(trim(coalesce(new.evaluation_kind,'')))='automatic' then
      raise exception 'automatic_conversation_review_is_system_owned'
        using errcode='42501';
    end if;
    if v_new_versioned then
      raise exception 'conversation_review_correction_is_command_owned'
        using errcode='42501';
    end if;
    return new;
  end if;

  if lower(trim(coalesce(old.evaluation_kind,'')))='automatic'
     or lower(trim(coalesce(new.evaluation_kind,'')))='automatic'
     or old.correction_kind is not null
     or v_new_versioned then
    -- Human review is an annotation layer, never a rewrite of system evidence or of a version.
    v_old_system := to_jsonb(old) - array[
      'manager_review_score',
      'manager_review_notes',
      'manager_reviewed_by',
      'manager_reviewed_at',
      'updated_at'
    ];
    v_new_system := to_jsonb(new) - array[
      'manager_review_score',
      'manager_review_notes',
      'manager_reviewed_by',
      'manager_reviewed_at',
      'updated_at'
    ];

    if v_new_system is distinct from v_old_system then
      if old.correction_kind is not null or v_new_versioned then
        raise exception 'conversation_review_version_is_immutable_for_client'
          using errcode='42501';
      end if;
      raise exception 'automatic_conversation_review_evidence_is_immutable_for_client'
        using errcode='42501';
    end if;
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------------------------
-- 4. A superseded version is frozen for EVERY role (service_role writers included), so a later
--    automatic re-analysis cannot rewrite or re-activate evidence a manager already corrected.
-- ---------------------------------------------------------------------------------------------
create or replace function public.dawaa_freeze_superseded_conversation_review_v1()
returns trigger
language plpgsql
set search_path to 'public','pg_catalog'
as $function$
begin
  if exists (
    select 1 from public.conversation_sales_reviews c
    where c.supersedes_review_id = old.id
  ) and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception 'conversation_review_version_superseded_is_frozen'
      using errcode='55000';
  end if;
  return new;
end;
$function$;

revoke all on function public.dawaa_freeze_superseded_conversation_review_v1()
  from public, anon, authenticated;

drop trigger if exists zzzzz_conversation_review_superseded_freeze_v1
  on public.conversation_sales_reviews;
create trigger zzzzz_conversation_review_superseded_freeze_v1
before update
on public.conversation_sales_reviews
for each row
execute function public.dawaa_freeze_superseded_conversation_review_v1();

-- ---------------------------------------------------------------------------------------------
-- 5. Points: reverse the superseded version once, apply the new version once (internal only).
-- ---------------------------------------------------------------------------------------------
create or replace function public.dawaa_apply_conversation_review_correction_points_v1(
  p_session_token text,
  p_correction_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions','pg_catalog'
as $function$
declare
  v_correction public.conversation_sales_reviews%rowtype;
  v_reversed jsonb;
  v_applied jsonb;
begin
  select * into v_correction
  from public.conversation_sales_reviews
  where id = p_correction_id
    and correction_kind is not null
    and is_current = true;
  if not found then
    raise exception 'conversation_review_correction_not_current' using errcode='55000';
  end if;

  -- Reverse the superseded version's live effective impact exactly once. Cancelling is a status
  -- change only (the ledger payload stays frozen) and a cancelled row is never touched again.
  with cancelled as (
    update public.employee_transactions et
       set status = 'cancelled',
           updated_at = now()
     where et.source_id = v_correction.supersedes_review_id
       and coalesce(et.source,'') in (
         'whatsapp_automatic_review','conversation_evaluation','conversation_review','conversation_sales_reviews'
       )
       and coalesce(et.status,'active') in ('active','approved','pending')
    returning et.id, et.staff_id, et.points_delta
  )
  select jsonb_build_object(
    'count', count(*),
    'transaction_ids', coalesce(jsonb_agg(id order by id), '[]'::jsonb),
    'points_delta_reversed', coalesce(sum(-coalesce(points_delta,0)), 0)
  )
  into v_reversed
  from cancelled;

  -- Apply the new version's impact through the existing review-points bridge. The bridge is keyed by
  -- (staff, cycle, conversation_evaluation, review id); once any ledger row exists for this version
  -- it is never re-posted, so an approval/cancellation done later by an admin is not overwritten.
  if exists (
    select 1 from public.employee_transactions et
    where et.source = 'conversation_evaluation'
      and et.source_id = v_correction.id
  ) then
    v_applied := jsonb_build_object('status','already_linked','review_id',v_correction.id);
  else
    v_applied := public.record_conversation_review_points_v1(p_session_token, v_correction.id);
  end if;

  return jsonb_build_object('reversed', v_reversed, 'applied', v_applied);
end;
$function$;

revoke all on function public.dawaa_apply_conversation_review_correction_points_v1(text,uuid)
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 5a. Harden the existing Production review-points caller: fail-closed account state.
--     Exact live body (pg_get_functiondef, 2026-10-08) with ONLY the account-state predicate
--     changed from coalesce(...,true)/coalesce(status,'active') to IS TRUE / lower(btrim(...)).
--     create or replace keeps the signature, return contract, owner and live grants
--     (anon, authenticated, service_role); nothing is re-granted or revoked here.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_conversation_review_points_v1(p_session_token text, p_review_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_catalog'
AS $function$
declare
  v_account public.staff_accounts%rowtype;
  v_review public.conversation_sales_reviews%rowtype;
  v_points numeric; v_status text; v_actor_role text; v_actor_branch text;
  v_is_global boolean; v_is_branch_manager boolean; v_result jsonb;
begin
  if nullif(btrim(coalesce(p_session_token,'')),'') is null then raise exception 'staff_session_required' using errcode='42501'; end if;
  select a.* into v_account from public.staff_login_sessions s join public.staff_accounts a on a.id=s.staff_account_id
  where s.token_hash=encode(extensions.digest(btrim(p_session_token),'sha256'),'hex') and s.revoked_at is null and s.expires_at>now()
    -- Fail closed: NULL in any account-state column denies (all four columns are nullable).
    and a.active is true and a.is_active is true and a.can_login is true and lower(btrim(coalesce(a.status,'')))='active' limit 1;
  if not found then raise exception 'invalid_or_expired_staff_session' using errcode='42501'; end if;
  select * into v_review from public.conversation_sales_reviews where id=p_review_id for update;
  if not found then raise exception 'conversation_review_not_found' using errcode='P0002'; end if;
  if v_review.reviewer_id is null or (v_review.reviewer_id::text is distinct from v_account.id::text and v_review.reviewer_id::text is distinct from coalesce(v_account.staff_id::text,'')) then
    raise exception 'review_author_session_mismatch' using errcode='42501'; end if;
  if v_review.staff_id is null then raise exception 'conversation_review_staff_missing' using errcode='23514'; end if;
  v_actor_role:=lower(btrim(coalesce(v_account.role,''))); v_actor_branch:=nullif(btrim(coalesce(v_account.branch,'')),'');
  v_is_global:=v_actor_role in ('general_manager','admin','executive_manager','branches_manager','manager','مدير عام','مدير تنفيذي','مديرة الفروع','مدير الفروع');
  v_is_branch_manager:=v_actor_role in ('branch_manager','customer_service_manager','مدير فرع','مديرة فرع','مسؤولة خدمة العملاء','مسؤول خدمة العملاء');
  if not v_is_global and not v_is_branch_manager then null;
  elsif v_is_branch_manager and not v_is_global and coalesce(btrim(v_review.branch),'') is distinct from coalesce(v_actor_branch,'') then
    raise exception 'not_authorized_for_branch' using errcode='42501'; end if;
  v_points:=coalesce(v_review.doctor_points_impact,v_review.point_impact,0);
  if v_points=0 then return jsonb_build_object('review_id',v_review.id,'status','no_points','points_delta',0); end if;
  v_status:=case when lower(coalesce(v_review.impact_status,''))='approved' then 'approved' else 'pending' end;
  perform set_config('request.headers',jsonb_build_object('x-dawaa-user-id',v_account.id::text)::text,true);
  v_result:=public.record_employee_points_transaction_v4(v_review.staff_id,v_points,
    format('تقييم محادثة عميل - النتيجة %s/100',coalesce(v_review.final_score,v_review.total_score,0)),
    coalesce(nullif(btrim(coalesce(v_review.reviewer_notes,'')),''),nullif(btrim(coalesce(v_review.training_recommendation,'')),'')),
    'conversation_evaluation',v_review.id,null,v_review.month_cycle,v_review.branch,v_status,null,
    jsonb_build_object('source_module','conversation_evaluation','review_id',v_review.id,'reviewer_account_id',v_account.id,'session_command','record_conversation_review_points_v1'),false);
  update public.staff_login_sessions set last_used_at=now(),expires_at=now()+interval '12 hours'
   where staff_account_id=v_account.id and token_hash=encode(extensions.digest(btrim(p_session_token),'sha256'),'hex') and revoked_at is null;
  return coalesce(v_result,'{}'::jsonb)||jsonb_build_object('review_id',v_review.id,'session_authorized',true);
end;$function$;

-- ---------------------------------------------------------------------------------------------
-- 5b. Criterion predicate used by the correction consistency checks (pure, internal).
-- ---------------------------------------------------------------------------------------------
create or replace function public.dawaa_conversation_review_chose_v1(p_criteria jsonb, p_key text, p_choices text[])
returns boolean
language sql
immutable
set search_path to 'pg_catalog'
as $function$
  select coalesce(lower(p_criteria->p_key->>'applies'),'')='true'
     and (p_choices is null or coalesce(p_criteria->p_key->>'choice','') = any(p_choices))
$function$;
revoke all on function public.dawaa_conversation_review_chose_v1(jsonb,text,text[]) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------------------------
-- 6. The staff-session correction command.
-- ---------------------------------------------------------------------------------------------
create or replace function public.dawaa_correct_conversation_review_session_v1(
  p_session_token text,
  p_review_id uuid,
  p_idempotency_key uuid,
  p_reason text,
  p_correction jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','extensions','pg_catalog'
as $function$
declare
  v_account public.staff_accounts%rowtype;
  v_role text;
  v_old public.conversation_sales_reviews%rowtype;
  v_existing public.conversation_sales_reviews%rowtype;
  v_staff public.staff%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_c jsonb := p_correction;
  v_eval_keys text[] := array[
    'level','conversation_level','final_score','doctor_points_impact','base_points_impact',
    'extra_penalty_points','impact_status','total_applicable_items','total_not_applicable_items',
    'total_applicable_points','earned_points','positive_points','negative_points','severe_error_points',
    'main_positive_reason','main_negative_reason','top_positive_reason','top_deduction_reason',
    'forgotten_customer','missed_sales_opportunity','missed_sale_opportunity','successful_cross_sell',
    'handled_angry_customer_well','excellent_case','has_critical_error','repeated_error_type',
    'raw_scores','review_items','response_speed_score','greeting_score','greeting_message_used',
    'doctor_name_used_in_greeting','doctor_name_used','doctor_name_score','customer_name_used',
    'customer_name_score','tone_language_score','bad_tone_flag','understanding_score','follow_up_score',
    'consultation_quality_score','dosage_explanation_score','alternative_handling_score',
    'sales_quality_score','upsell_cross_sell_score','complaint_handling_score','order_confirmation_score',
    'closing_message_score','reviewer_notes','training_recommendation','evaluation_reason',
    -- derived flag columns (same rules as src/lib/reviews/conversationReviewEvaluationColumns.ts)
    'has_complaint','has_medical_error','has_invoice_error','has_delivery_issue',
    'severe_bad_tone_flag','rushed_response_flag','misunderstood_customer_flag',
    'bad_alternative_flag','closing_message_used','follow_up_promised'
  ];
  v_unknown text;
  v_missing text;
  v_inconsistent text;
  v_crit jsonb;
  v_sev jsonb;
  v_res jsonb;
  v_item_points jsonb;
  v_staff_id uuid;
  v_score numeric;
  v_impact numeric;
  v_base numeric;
  v_extra numeric;
  v_items integer;
  v_applicable_points numeric;
  v_earned numeric;
  v_successor uuid;
  v_new_id uuid := gen_random_uuid();
  v_now timestamptz := now();
  v_row jsonb;
  v_points jsonb;
begin
  -- 1. Authenticate the opaque Dawaa staff session (never a request header or Supabase Auth).
  if nullif(btrim(coalesce(p_session_token,'')),'') is null then
    raise exception 'staff_session_required' using errcode='42501';
  end if;

  select a.*
  into v_account
  from public.staff_login_sessions s
  join public.staff_accounts a on a.id=s.staff_account_id
  where s.token_hash=encode(extensions.digest(btrim(p_session_token),'sha256'),'hex')
    and s.revoked_at is null
    and s.expires_at>now()
    -- Fail closed: NULL in any account-state column denies (all four columns are nullable).
    and a.active is true
    and a.is_active is true
    and a.can_login is true
    and lower(btrim(coalesce(a.status,'')))='active'
  limit 1;

  if not found then
    raise exception 'invalid_or_expired_staff_session' using errcode='42501';
  end if;

  -- 2. Permission: the same edit/approve review authority the review UPDATE policy requires,
  --    resolved for the session-bound account through the canonical permission resolver.
  v_role:=lower(btrim(coalesce(v_account.role,'')));
  if v_role not in ('general_manager','admin')
     and not public.dawaa_jsonb_has_true_any(
       coalesce(public.get_user_permissions(v_account.id),'{}'::jsonb),
       array['edit_reviews','approve_reviews','manage_conversation_evaluations']
     ) then
    raise exception 'not_authorized' using errcode='42501';
  end if;

  -- 3. Explicit target, idempotency key, mandatory reason, whitelisted payload.
  if p_review_id is null then
    raise exception 'review_id_required' using errcode='22023';
  end if;
  if p_idempotency_key is null then
    raise exception 'idempotency_key_required' using errcode='22023';
  end if;
  if v_reason is null then
    raise exception 'correction_reason_required' using errcode='22023';
  end if;
  if length(v_reason)>2000 then
    raise exception 'correction_reason_too_long' using errcode='22023';
  end if;
  if v_c is null or jsonb_typeof(v_c)<>'object' then
    raise exception 'correction_payload_invalid' using errcode='22023';
  end if;
  select k into v_unknown
  from jsonb_object_keys(v_c) k
  where k <> 'staff_id' and not (k = any(v_eval_keys))
  limit 1;
  if v_unknown is not null then
    raise exception 'correction_payload_unknown_field:%', v_unknown using errcode='22023';
  end if;
  -- Strict whitelist: every evaluation key must be present (JSON null allowed only where the
  -- consistency checks below accept it), so nothing is silently inherited from the old version.
  select k into v_missing
  from unnest(v_eval_keys) k
  where not (v_c ? k)
  limit 1;
  if v_missing is not null then
    raise exception 'correction_payload_missing_field:%', v_missing using errcode='22023';
  end if;

  -- 4. Lock the target version, then scope it to the session account (branch/source access).
  select * into v_old
  from public.conversation_sales_reviews
  where id=p_review_id
  for update;
  if not found then
    raise exception 'conversation_review_not_found' using errcode='P0002';
  end if;

  if not public.dawaa_can_read_conversation_review_row_v2(v_account.id,null::uuid,null::uuid,v_old.branch,null::uuid) then
    raise exception 'review_scope_denied' using errcode='42501';
  end if;
  if v_old.whatsapp_review_source_id is not null and not exists (
    select 1 from public.whatsapp_review_sources s
    where s.id=v_old.whatsapp_review_source_id
      and public.dawaa_can_read_conversation_review_row_v2(v_account.id,null::uuid,null::uuid,s.branch,null::uuid)
  ) then
    raise exception 'review_source_scope_denied' using errcode='42501';
  end if;
  if nullif(btrim(coalesce(v_account.staff_id,'')),'') is not null
     and v_account.staff_id in (coalesce(v_old.staff_id::text,''), coalesce(v_old.doctor_id::text,'')) then
    raise exception 'self_correction_forbidden' using errcode='42501';
  end if;

  -- 5. Idempotent replay: the same key returns the same version and converges its points.
  select * into v_existing
  from public.conversation_sales_reviews
  where correction_idempotency_key=p_idempotency_key;
  if found then
    if v_existing.supersedes_review_id is distinct from p_review_id then
      raise exception 'idempotency_key_conflict' using errcode='23505';
    end if;
    if v_existing.is_current then
      v_points := public.dawaa_apply_conversation_review_correction_points_v1(p_session_token, v_existing.id);
    end if;
    return jsonb_build_object(
      'status','already_applied',
      'review_id',v_existing.id,
      'superseded_review_id',p_review_id,
      'is_current',v_existing.is_current,
      'points',v_points,
      'session_authorized',true
    );
  end if;

  -- 6. Only the current automatic/correction version may be corrected. Human reviews keep their
  --    own editor path; a stale editor is told which version replaced its review.
  if lower(btrim(coalesce(v_old.evaluation_kind,''))) not in ('automatic','manager_correction') then
    raise exception 'review_not_versioned' using errcode='22023';
  end if;
  if v_old.is_current is not true then
    select c.id into v_successor
    from public.conversation_sales_reviews c
    where c.supersedes_review_id=v_old.id;
    raise exception 'review_version_not_current'
      using errcode='55000', detail=coalesce(v_successor::text,'');
  end if;

  -- 7. Responsible staff (may be reassigned): must exist and be inside the actor's scope.
  begin
    v_staff_id := nullif(btrim(coalesce(v_c->>'staff_id','')),'')::uuid;
  exception when others then
    raise exception 'correction_staff_invalid' using errcode='22023';
  end;
  if v_staff_id is null then
    raise exception 'correction_staff_required' using errcode='22023';
  end if;
  select * into v_staff from public.staff where id=v_staff_id;
  if not found then
    raise exception 'correction_staff_not_found' using errcode='P0002';
  end if;
  if v_staff_id is distinct from coalesce(v_old.staff_id,v_old.doctor_id)
     and not public.dawaa_can_read_conversation_review_row_v2(v_account.id,null::uuid,null::uuid,v_staff.branch,null::uuid) then
    raise exception 'correction_staff_scope_denied' using errcode='42501';
  end if;
  if nullif(btrim(coalesce(v_account.staff_id,'')),'') is not null
     and v_account.staff_id = v_staff_id::text then
    raise exception 'self_correction_forbidden' using errcode='42501';
  end if;

  -- 8. Bounded, internally consistent evaluation values.
  begin
    v_score := (v_c->>'final_score')::numeric;
    v_impact := (v_c->>'doctor_points_impact')::numeric;
    v_base := (v_c->>'base_points_impact')::numeric;
    v_extra := coalesce((v_c->>'extra_penalty_points')::numeric,0);
    v_items := (v_c->>'total_applicable_items')::integer;
    v_applicable_points := (v_c->>'total_applicable_points')::numeric;
    v_earned := (v_c->>'earned_points')::numeric;
  exception when others then
    raise exception 'correction_payload_invalid' using errcode='22023';
  end;
  if v_score is null or v_score<0 or v_score>100
     or v_impact is null or v_impact<-20 or v_impact>6
     or v_base is null or v_base<-10 or v_base>6
     or v_extra>0
     or coalesce(v_items,0)<1
     or coalesce(v_applicable_points,0)<=0
     or v_earned is null or v_earned<0 or v_earned>v_applicable_points
     or coalesce(v_c->>'impact_status','') not in ('approved','pending')
     or jsonb_typeof(v_c->'raw_scores') is distinct from 'object'
     or length(coalesce(v_c->>'reviewer_notes',''))>5000
     or length(coalesce(v_c->>'training_recommendation',''))>5000
     or length(coalesce(v_c->>'evaluation_reason',''))>500 then
    raise exception 'correction_payload_invalid' using errcode='22023';
  end if;
  -- (separate statement: SQL does not short-circuit OR, and array length of a non-array raises)
  if jsonb_typeof(v_c->'review_items') is distinct from 'array' then
    raise exception 'correction_payload_invalid' using errcode='22023';
  end if;
  if jsonb_array_length(v_c->'review_items') not between 1 and 100 then
    raise exception 'correction_payload_invalid' using errcode='22023';
  end if;

  -- 8b. One evaluation, one truth: every evaluation-derived column must equal what the payload's own
  --     raw_scores (criteria, severe_errors, result) and review_items say. Comparison is jsonb
  --     equality (numbers compare numerically; booleans must be JSON booleans).
  v_crit := v_c->'raw_scores'->'criteria';
  v_sev := v_c->'raw_scores'->'severe_errors';
  v_res := v_c->'raw_scores'->'result';
  if jsonb_typeof(v_crit) is distinct from 'object' then
    raise exception 'correction_payload_inconsistent:raw_scores.criteria' using errcode='22023';
  end if;
  if jsonb_typeof(v_sev) is distinct from 'object' then
    raise exception 'correction_payload_inconsistent:raw_scores.severe_errors' using errcode='22023';
  end if;
  if jsonb_typeof(v_res) is distinct from 'object' then
    raise exception 'correction_payload_inconsistent:raw_scores.result' using errcode='22023';
  end if;
  -- per-criterion score columns = pointsEarned of that applying review item, else null
  select coalesce(jsonb_object_agg(i->>'key',
           case when lower(coalesce(i->>'applies',''))='true' then coalesce(i->'pointsEarned','null'::jsonb) else 'null'::jsonb end),
         '{}'::jsonb)
  into v_item_points
  from jsonb_array_elements(v_c->'review_items') i
  where jsonb_typeof(i)='object' and nullif(i->>'key','') is not null;

  select e.col into v_inconsistent
  from (values
    ('final_score', v_res->'finalScore'),
    ('doctor_points_impact', v_res->'doctorPointsImpact'),
    ('base_points_impact', v_res->'baseDoctorImpact'),
    ('extra_penalty_points', v_res->'extraPenaltyPoints'),
    ('impact_status', v_res->'impactStatus'),
    ('total_applicable_items', v_res->'totalApplicableItems'),
    ('total_not_applicable_items', v_res->'totalNotApplicableItems'),
    ('total_applicable_points', v_res->'totalApplicablePoints'),
    ('earned_points', v_res->'earnedPoints'),
    ('positive_points', v_res->'earnedPoints'),
    ('negative_points', to_jsonb(greatest(0::numeric, v_applicable_points - v_earned))),
    ('severe_error_points', to_jsonb(abs(v_extra))),
    ('level', v_res->'level'),
    ('conversation_level', v_res->'level'),
    ('main_positive_reason', v_res->'mainPositiveReason'),
    ('main_negative_reason', v_res->'mainNegativeReason'),
    ('top_positive_reason', v_res->'mainPositiveReason'),
    ('top_deduction_reason', v_res->'mainNegativeReason'),
    ('forgotten_customer', v_res->'forgottenCustomer'),
    ('missed_sales_opportunity', v_res->'missedSalesOpportunity'),
    ('missed_sale_opportunity', v_res->'missedSalesOpportunity'),
    ('successful_cross_sell', v_res->'successfulCrossSell'),
    ('handled_angry_customer_well', v_res->'handledAngryCustomerWell'),
    ('excellent_case', v_res->'excellentCase'),
    ('has_critical_error', v_res->'hasSevereError'),
    ('repeated_error_type', v_res->'repeatErrorType'),
    ('review_items', v_res->'reviewItems'),
    ('response_speed_score', v_item_points->'first_response_speed'),
    ('greeting_score', v_item_points->'greeting'),
    ('doctor_name_score', v_item_points->'doctor_name'),
    ('customer_name_score', v_item_points->'customer_name'),
    ('tone_language_score', v_item_points->'tone'),
    ('understanding_score', v_item_points->'understanding'),
    ('follow_up_score', v_item_points->'followup_after_wait'),
    ('consultation_quality_score', v_item_points->'consultation_quality'),
    ('dosage_explanation_score', v_item_points->'dosage_explanation'),
    ('alternative_handling_score', v_item_points->'unavailable_items'),
    ('sales_quality_score', v_item_points->'sales_closing'),
    ('upsell_cross_sell_score', v_item_points->'cross_sell_upsell'),
    ('complaint_handling_score', v_item_points->'angry_customer'),
    ('order_confirmation_score', v_item_points->'order_confirmation'),
    ('closing_message_score', v_item_points->'closing_message'),
    ('doctor_name_used_in_greeting', to_jsonb(public.dawaa_conversation_review_chose_v1(v_crit,'greeting',array['official_full','close_with_name']))),
    ('doctor_name_used', to_jsonb(public.dawaa_conversation_review_chose_v1(v_crit,'doctor_name',null)
                                  and coalesce(v_crit->'doctor_name'->>'choice','') <> 'none')),
    ('customer_name_used', to_jsonb(public.dawaa_conversation_review_chose_v1(v_crit,'customer_name',array['used']))),
    ('has_complaint', to_jsonb(public.dawaa_conversation_review_chose_v1(v_crit,'angry_customer',null)
                               or lower(coalesce(v_sev->>'insult',''))='true')),
    ('has_medical_error', to_jsonb(lower(coalesce(v_sev->>'medical_error',''))='true'
                                   or exists (select 1 from jsonb_array_elements(v_c->'review_items') i
                                              where jsonb_typeof(i)='object' and i->>'errorType'='medical_error'))),
    ('has_invoice_error', to_jsonb(lower(coalesce(v_sev->>'invoice_error',''))='true')),
    ('has_delivery_issue', to_jsonb(lower(coalesce(v_sev->>'delivery_error',''))='true')),
    ('bad_tone_flag', to_jsonb(public.dawaa_conversation_review_chose_v1(v_crit,'tone',array['dry','bad','very_bad','insult']))),
    ('severe_bad_tone_flag', to_jsonb(public.dawaa_conversation_review_chose_v1(v_crit,'tone',array['very_bad','insult']))),
    ('rushed_response_flag', to_jsonb(public.dawaa_conversation_review_chose_v1(v_crit,'understanding',array['rushed']))),
    ('misunderstood_customer_flag', to_jsonb(public.dawaa_conversation_review_chose_v1(v_crit,'understanding',array['wrong','caused_error']))),
    ('bad_alternative_flag', to_jsonb(public.dawaa_conversation_review_chose_v1(v_crit,'unavailable_items',array['bad_alternative']))),
    ('closing_message_used', to_jsonb(public.dawaa_conversation_review_chose_v1(v_crit,'closing_message',array['official','respectful']))),
    ('follow_up_promised', to_jsonb(public.dawaa_conversation_review_chose_v1(v_crit,'followup_after_wait',null)))
  ) e(col, expected)
  where coalesce(v_c->e.col,'null'::jsonb) is distinct from coalesce(e.expected,'null'::jsonb)
  limit 1;
  if v_inconsistent is not null then
    raise exception 'correction_payload_inconsistent:%', v_inconsistent using errcode='22023';
  end if;

  -- 9. Version switch, part 1: the old version leaves current truth. Only is_current/superseded_*
  --    (and updated_at) change; the evidence itself is untouched and then frozen.
  update public.conversation_sales_reviews
     set is_current=false,
         superseded_at=v_now,
         superseded_reason=left('manager_correction: '||v_reason,2000),
         updated_at=v_now
   where id=v_old.id;

  -- 10. Version switch, part 2: the corrected version. Provenance comes from the old version; the
  --     evaluation comes only from whitelisted keys (a missing key is NULL, never the old value);
  --     identity, lineage and reviewer are server-bound.
  v_row := to_jsonb(v_old)
    || (select coalesce(jsonb_object_agg(k, v_c->k),'{}'::jsonb) from unnest(v_eval_keys) k)
    || jsonb_build_object(
      'id', v_new_id,
      'created_at', v_now,
      'updated_at', v_now,
      'reviewed_at', v_now,
      'evaluation_kind', 'manager_correction',
      'correction_kind', 'manager_full_correction',
      'supersedes_review_id', v_old.id,
      'correction_reason', v_reason,
      'correction_idempotency_key', p_idempotency_key,
      'reviewer_id', v_account.id,
      'reviewer_name', coalesce(nullif(btrim(coalesce(v_account.name,'')),''),nullif(btrim(coalesce(v_account.staff_name,'')),''),v_account.username),
      'reviewer_role', v_account.role,
      'reviewer_message', null,
      -- the conversation/source branch, never the (possibly different) branch of the new staff
      'branch', v_old.branch,
      'branch_id', v_old.branch_id,
      'staff_id', v_staff.id,
      'doctor_id', v_staff.id,
      'staff_name', v_staff.name,
      'doctor_name', v_staff.name,
      'staff_role', v_staff.role,
      'total_score', v_c->'final_score',
      'point_impact', v_c->'doctor_points_impact',
      'raw_scores', (v_c->'raw_scores') || jsonb_build_object(
        'manager_correction', jsonb_build_object(
          'kind', 'manager_full_correction',
          'reason', v_reason,
          'corrected_by_account_id', v_account.id,
          'corrected_at', v_now,
          'supersedes_review_id', v_old.id,
          'previous_evaluation_kind', v_old.evaluation_kind,
          'previous_final_score', coalesce(v_old.final_score,v_old.total_score),
          'previous_points_impact', coalesce(v_old.doctor_points_impact,v_old.point_impact,0),
          'previous_staff_id', coalesce(v_old.staff_id,v_old.doctor_id)
        )
      ),
      'is_current', true,
      'superseded_at', null,
      'superseded_reason', null,
      'manager_review_score', null,
      'manager_review_notes', null,
      'manager_reviewed_by', null,
      'manager_reviewed_at', null,
      'submission_fingerprint', null
    );

  insert into public.conversation_sales_reviews
  select (jsonb_populate_record(null::public.conversation_sales_reviews, v_row)).*;

  -- 11. Points in the same transaction: a failure here rolls back the version switch too.
  v_points := public.dawaa_apply_conversation_review_correction_points_v1(p_session_token, v_new_id);

  return jsonb_build_object(
    'status','created',
    'review_id',v_new_id,
    'superseded_review_id',v_old.id,
    'is_current',true,
    'points',v_points,
    'session_authorized',true
  );
end;
$function$;

-- Supabase default privileges grant new functions to anon/authenticated/service_role; reset
-- explicitly. anon/authenticated are required because the browser uses the anon key with the
-- custom staff session; the token check above is the authentication boundary.
revoke all on function public.dawaa_correct_conversation_review_session_v1(text,uuid,uuid,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.dawaa_correct_conversation_review_session_v1(text,uuid,uuid,text,jsonb)
  to anon, authenticated;

comment on function public.dawaa_correct_conversation_review_session_v1(text,uuid,uuid,text,jsonb) is
  'Staff-session-authenticated manager full correction: supersedes the current automatic/correction version with a new manager_correction version (FK lineage), reverses/applies points once, idempotent per key.';

-- ---------------------------------------------------------------------------------------------
-- 7. Case lifecycle follower: when Sales Intelligence retires/reactivates a case, the current
--    correction head follows it exactly like the automatic row does (SI functions are unchanged).
-- ---------------------------------------------------------------------------------------------
create or replace function public.dawaa_follow_case_lifecycle_for_review_corrections_v1()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if old.is_active is true and new.is_active is not true then
    update public.conversation_sales_reviews r
       set is_current=false,
           superseded_at=now(),
           superseded_reason='sales_intelligence_case_retired',
           updated_at=now()
     where r.sales_intelligence_case_id=new.case_id
       and r.correction_kind is not null
       and r.is_current=true;
  elsif old.is_active is not true and new.is_active is true then
    update public.conversation_sales_reviews r
       set is_current=true,
           superseded_at=null,
           superseded_reason=null,
           updated_at=now()
     where r.sales_intelligence_case_id=new.case_id
       and r.correction_kind is not null
       and r.is_current=false
       and r.superseded_reason='sales_intelligence_case_retired'
       and not exists (
         select 1 from public.conversation_sales_reviews n where n.supersedes_review_id=r.id
       );
  end if;
  return new;
end;
$function$;

revoke all on function public.dawaa_follow_case_lifecycle_for_review_corrections_v1()
  from public, anon, authenticated;

drop trigger if exists sales_intelligence_case_review_correction_lifecycle_v1
  on public.sales_intelligence_cases;
create trigger sales_intelligence_case_review_correction_lifecycle_v1
after update of is_active
on public.sales_intelligence_cases
for each row
execute function public.dawaa_follow_case_lifecycle_for_review_corrections_v1();

-- ---------------------------------------------------------------------------------------------
-- 8. Official/canonical reads resolve the current version only. Today every row is current, so the
--    official view's result is unchanged until the first supersession. The canonical view is
--    re-created only to expose the lineage columns (appended at the end).
-- ---------------------------------------------------------------------------------------------
create or replace view public.conversation_sales_reviews_official_v1
with (security_invoker = true)
as
select
  id, reviewer_id, reviewer_name, reviewer_role, staff_id, staff_name, staff_role, branch,
  customer_id, customer_name, customer_code, customer_phone, evaluation_kind, invoice_number,
  invoice_time, evaluation_reason, total_score, raw_scores, has_complaint, has_medical_error,
  has_invoice_error, reviewer_notes, training_recommendation, final_score, point_impact,
  impact_status, reviewed_at, created_at, base_score, positive_points, negative_points,
  severe_error_points, doctor_points_impact, conversation_level, top_positive_reason,
  top_deduction_reason, forgotten_customer, missed_sale_opportunity, has_critical_error,
  repeated_error_type, repeat_count, repeat_multiplier, month_cycle, doctor_id, branch_id,
  conversation_date, conversation_type, level, base_points_impact, extra_penalty_points,
  total_applicable_items, total_not_applicable_items, total_applicable_points, earned_points,
  main_positive_reason, main_negative_reason, review_items, first_customer_message_at,
  first_staff_reply_at, first_response_minutes, response_speed_score, greeting_score,
  greeting_message_used, doctor_name_used_in_greeting, doctor_name_used, doctor_name_score,
  customer_name_used, customer_name_score, tone_language_score, bad_tone_flag,
  severe_bad_tone_flag, understanding_score, rushed_response_flag, misunderstood_customer_flag,
  follow_up_promised, follow_up_delay_minutes, follow_up_score, consultation_quality_score,
  dosage_explanation_score, alternative_handling_score, bad_alternative_flag, sales_quality_score,
  upsell_cross_sell_score, successful_cross_sell, complaint_handling_score,
  handled_angry_customer_well, excellent_case, order_confirmation_score, has_delivery_issue,
  missed_sales_opportunity, closing_message_score, closing_message_used, updated_at, doctor_name,
  review_date, reviewer_message, manager_review_score, manager_review_notes, manager_reviewed_by,
  manager_reviewed_at, converted_to_sale, submission_fingerprint, whatsapp_review_source_id
from public.conversation_sales_reviews r
where coalesce(r.is_current,true)=true
  and (
    r.whatsapp_review_source_id is null
    or exists (
      select 1
      from public.whatsapp_operational_canonical_sources_v1 o
      where o.source_id = r.whatsapp_review_source_id
    )
  );

create or replace view public.conversation_sales_reviews_canonical_v2
with (security_invoker = true)
as
with current_rows as (
  select r.*
  from public.conversation_sales_reviews r
  where coalesce(r.is_current,true)=true
    and (
      r.whatsapp_review_source_id is null
      or exists (
        select 1
        from public.whatsapp_operational_canonical_sources_v1 s
        where s.source_id=r.whatsapp_review_source_id
      )
    )
)
select r.*
from current_rows r
where r.whatsapp_review_source_id is null
   or r.sales_intelligence_case_id is not null
   or not exists (
     select 1
     from current_rows a
     where a.whatsapp_review_source_id=r.whatsapp_review_source_id
       and a.sales_intelligence_case_id is not null
   );

comment on view public.conversation_sales_reviews_official_v1 is
  'Official conversation reviews: current versions of canonical sources only. Superseded versions stay in conversation_sales_reviews for audit (lineage via supersedes_review_id).';

notify pgrst,'reload schema';

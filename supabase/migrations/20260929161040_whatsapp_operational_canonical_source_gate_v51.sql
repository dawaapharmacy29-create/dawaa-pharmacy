-- V51: Canonical Operational Source Gate (STEP 3C-3).
--
-- One owner for "is this WhatsApp source operationally canonical now?":
--   public.whatsapp_operational_canonical_sources_v1
-- It is the database form of the existing Canonical Source Gate
-- (src/lib/salesIntelligence/persistence/canonicalSourceGate.ts, evaluateCanonicalSourceGate /
-- loadCanonicalAnalyticalSources). A source is operational only when:
--   * it is not archived;
--   * it is not superseded: no other non-archived, V22-owned source of the same export lies inside
--     its time window with its full text contained in this source's text (coarse re-segmentation);
--   * it is owned by exactly one Customer Case V22 (root_source_id or source_ids).
-- Zero owners (historical snapshot) and several owners (ambiguous) both fail closed.
-- The filename only groups siblings of one export; it never decides identity. The TS resolver and
-- this view are kept equal by scripts/check-whatsapp-operational-source-owner-parity.ts (CI).
--
-- Operational readers are routed through the owner; their columns are unchanged:
--   whatsapp_recovery_work_queue_v1 (→ v2 → whatsapp_recovery_staff_kpis_v1),
--   whatsapp_product_journey_detail_v1 (doctor cycle, recoverable opportunities),
--   whatsapp_product_demand_unresolved_detail_v22 (unresolved demand),
--   whatsapp_order_lifecycle_v19 (current lifecycle),
--   whatsapp_source_evaluation_coverage_v17 (coverage),
--   whatsapp_customer_story_360_v1 (open actions current-only; every event kept as history and
--     tagged "operational").
-- No row is written, archived, dismissed or deleted: visibility changes, storage does not.

create or replace view public.whatsapp_operational_canonical_sources_v1
with (security_invoker = true)
as
with owners as (
  select s.id as source_id,
         count(distinct c.id) as owner_count,
         min(c.id::text) as v22_case_id
  from public.whatsapp_review_sources s
  join public.whatsapp_customer_cases_v22 c
    on c.root_source_id = s.id or s.id = any(c.source_ids)
  group by s.id
)
select s.id as source_id,
       o.v22_case_id::uuid as v22_case_id
from public.whatsapp_review_sources s
join owners o on o.source_id = s.id and o.owner_count = 1
where coalesce(s.review_status, '') <> 'archived'
  and not exists (
    select 1
    from public.whatsapp_review_sources f
    where f.id <> s.id
      and f.source_filename = s.source_filename
      and coalesce(f.review_status, '') <> 'archived'
      and f.conversation_started_at >= s.conversation_started_at
      and f.conversation_ended_at <= s.conversation_ended_at
      and coalesce(f.raw_text, '') <> ''
      and coalesce(s.raw_text, '') <> ''
      and position(f.raw_text in s.raw_text) > 0
      and exists (select 1 from owners o2 where o2.source_id = f.id)
  );

comment on view public.whatsapp_operational_canonical_sources_v1 is
  'Single owner of operational canonicality for WhatsApp sources (mirrors canonicalSourceGate.ts). Non-listed sources are historical evidence only.';

grant select on public.whatsapp_operational_canonical_sources_v1 to anon, authenticated, service_role;

-- Recovery queue (current work): actions of operational sources only.
create or replace view public.whatsapp_recovery_work_queue_v1
with (security_invoker = true)
as
 SELECT a.id AS action_id,
    a.source_id,
    a.action_key,
    a.action_type,
    a.status AS materialization_status,
    a.work_status,
    a.confidence,
    a.auto_eligible,
    a.branch,
    a.customer_id,
    a.customer_code,
    a.customer_name,
    a.customer_phone,
    a.staff_id,
    a.staff_name,
    a.product_id,
    a.product_code,
    a.product_name,
    a.quantity,
    a.due_at,
    a.reason,
    a.assigned_to_id,
    a.assigned_to_name,
    a.assigned_at,
    a.started_at,
    a.completed_at,
    a.outcome,
    a.outcome_note,
    a.recovered_invoice_id,
    a.recovered_invoice_number,
    a.recovered_invoice_value,
    a.recovered_at,
    a.created_at,
    a.updated_at,
    s.conversation_started_at,
    s.conversation_ended_at,
    s.invoice_match_status,
    s.matched_invoice_number,
    s.matched_invoice_value,
    s.analysis_confidence,
    s.review_status,
        CASE
            WHEN a.work_status = 'completed'::text THEN 99
            WHEN a.due_at IS NOT NULL AND a.due_at <= now() THEN 1
            WHEN a.action_type = 'complaint_followup'::text THEN 2
            WHEN a.action_type = ANY (ARRAY['customer_request'::text, 'recommendation_followup'::text]) THEN 3
            ELSE 4
        END AS work_priority_rank
   FROM whatsapp_conversation_actions a
     JOIN whatsapp_review_sources s ON s.id = a.source_id
  WHERE (a.action_type = ANY (ARRAY['customer_request'::text, 'customer_followup'::text, 'recommendation_followup'::text, 'complaint_followup'::text, 'invoice_recheck'::text])) AND a.status <> 'dismissed'::text
    AND EXISTS (SELECT 1 FROM whatsapp_operational_canonical_sources_v1 o WHERE o.source_id = a.source_id);

-- Product journey detail (doctor cycle, recoverable opportunities): operational sources only.
create or replace view public.whatsapp_product_journey_detail_v1
with (security_invoker = true)
as
 SELECT s.id AS source_id,
    s.branch,
    s.customer_id,
    s.customer_code,
    s.customer_name,
    s.customer_phone,
    s.staff_id,
    s.staff_name,
    s.conversation_started_at,
    s.conversation_ended_at,
        CASE
            WHEN EXTRACT(day FROM (s.conversation_started_at AT TIME ZONE 'Africa/Cairo'::text)) >= 26::numeric THEN (date_trunc('month'::text, (s.conversation_started_at AT TIME ZONE 'Africa/Cairo'::text)) + '25 days'::interval)::date
            ELSE (date_trunc('month'::text, (s.conversation_started_at AT TIME ZONE 'Africa/Cairo'::text)) - '1 mon'::interval + '25 days'::interval)::date
        END AS cycle_start,
        CASE
            WHEN EXTRACT(day FROM (s.conversation_started_at AT TIME ZONE 'Africa/Cairo'::text)) >= 26::numeric THEN ((date_trunc('month'::text, (s.conversation_started_at AT TIME ZONE 'Africa/Cairo'::text)) + '25 days'::interval)::date + '1 mon'::interval - '1 day'::interval)::date
            ELSE ((date_trunc('month'::text, (s.conversation_started_at AT TIME ZONE 'Africa/Cairo'::text)) - '1 mon'::interval + '25 days'::interval)::date + '1 mon'::interval - '1 day'::interval)::date
        END AS cycle_end,
    j.value ->> 'productName'::text AS product_name,
    NULLIF(j.value ->> 'productCode'::text, ''::text) AS product_code,
    NULLIF(j.value ->> 'productId'::text, ''::text) AS product_id,
    NULLIF(j.value ->> 'quantity'::text, ''::text)::numeric AS quantity,
    j.value ->> 'currentStage'::text AS current_stage,
    COALESCE((j.value ->> 'saleIntent'::text)::boolean, false) AS sale_intent,
    COALESCE((j.value ->> 'closedInChat'::text)::boolean, false) AS closed_in_chat,
    COALESCE((j.value ->> 'followupCandidate'::text)::boolean, false) AS followup_candidate,
    NULLIF(TRIM(BOTH FROM j.value ->> 'leakageReason'::text), ''::text) AS leakage_reason,
    j.value ->> 'nextAction'::text AS next_action,
    NULLIF(j.value ->> 'confidence'::text, ''::text)::numeric AS confidence,
    s.invoice_match_status,
    s.matched_invoice_number,
    s.matched_invoice_value,
    s.invoice_match_confidence,
    s.review_status,
    s.official_review_id
   FROM whatsapp_review_sources s
     CROSS JOIN LATERAL jsonb_array_elements(
        CASE
            WHEN jsonb_typeof(((s.analysis_json -> 'operational'::text) -> 'productJourney'::text) -> 'journeys'::text) = 'array'::text THEN ((s.analysis_json -> 'operational'::text) -> 'productJourney'::text) -> 'journeys'::text
            ELSE '[]'::jsonb
        END) j(value)
  WHERE s.conversation_started_at IS NOT NULL
    AND EXISTS (SELECT 1 FROM whatsapp_operational_canonical_sources_v1 o WHERE o.source_id = s.id);

-- Unresolved product demand: operational sources only.
create or replace view public.whatsapp_product_demand_unresolved_detail_v22
with (security_invoker = true)
as
 WITH raw_unresolved AS (
         SELECT s.id AS source_id,
            s.branch,
            s.customer_id,
            s.customer_code,
            s.customer_name,
            s.customer_phone,
            s.conversation_started_at,
            p.value ->> 'rawName'::text AS raw_name,
            p.value ->> 'status'::text AS product_status,
            NULLIF(p.value ->> 'confidence'::text, ''::text)::numeric AS confidence
           FROM whatsapp_review_sources s
             CROSS JOIN LATERAL jsonb_array_elements(COALESCE(s.analysis_json #> '{operational,products}'::text[], '[]'::jsonb)) p(value)
          WHERE (s.analysis_json ->> 'productDemandVersion'::text) = 'product-demand-v22.1'::text AND COALESCE(p.value ->> 'productId'::text, ''::text) = ''::text
            AND EXISTS (SELECT 1 FROM whatsapp_operational_canonical_sources_v1 o WHERE o.source_id = s.id)
        ), classified AS (
         SELECT raw_unresolved.source_id,
            raw_unresolved.branch,
            raw_unresolved.customer_id,
            raw_unresolved.customer_code,
            raw_unresolved.customer_name,
            raw_unresolved.customer_phone,
            raw_unresolved.conversation_started_at,
            raw_unresolved.raw_name,
            raw_unresolved.product_status,
            raw_unresolved.confidence,
                CASE
                    WHEN raw_unresolved.raw_name IS NULL OR length(TRIM(BOTH FROM raw_unresolved.raw_name)) < 2 THEN 'noise'::text
                    WHEN raw_unresolved.raw_name ~* '^(بالظبط|عليه|شكله|يهم|يكون فيه|بعد اذنك|اعرف مكان|يجيلي عند|هم تحويل|لحضرتك الاسكرينه)'::text THEN 'noise'::text
                    WHEN raw_unresolved.raw_name ~* '(نفس|\\mده\\M|\\mدي\\M|العلبه|العلبة|الغسول|العسل|القطره|القطرة|اللي لسه بعته|الا لسه بعته)'::text THEN 'reference_or_media'::text
                    WHEN raw_unresolved.raw_name ~* '(باكيت|مقاس|عدد|قطعه|قطعة)'::text AND raw_unresolved.raw_name !~* '[A-Za-z]{3,}'::text THEN 'contextual_product_reference'::text
                    WHEN raw_unresolved.raw_name ~* '(للحموضه|للحموضة|فيتامين|للعين|للارهاق|للإرهاق|للخمول|لزياده رغبه|لزيادة رغبة|استشاره|استشارة|حاجه كويسه|حاجة كويسة)'::text THEN 'category_need'::text
                    ELSE 'named_product_unresolved'::text
                END AS unresolved_type
           FROM raw_unresolved
        )
 SELECT source_id,
    branch,
    customer_id,
    customer_code,
    customer_name,
    customer_phone,
    conversation_started_at,
    dawaa_cycle_start_26((conversation_started_at AT TIME ZONE 'Africa/Cairo'::text)::date) AS cycle_start,
    dawaa_cycle_end_25((conversation_started_at AT TIME ZONE 'Africa/Cairo'::text)::date) AS cycle_end,
    raw_name,
    product_status,
    confidence,
    unresolved_type
   FROM classified;

-- Current order lifecycle: evidence facts of operational sources only.
create or replace view public.whatsapp_order_lifecycle_v19
with (security_invoker = true)
as
 WITH f AS (
         SELECT COALESCE(whatsapp_evidence_facts_v17.story_id::text, 'source:'::text || whatsapp_evidence_facts_v17.source_id::text) AS case_key,
            whatsapp_evidence_facts_v17.story_id,
            whatsapp_evidence_facts_v17.branch,
            whatsapp_evidence_facts_v17.customer_id,
            whatsapp_evidence_facts_v17.customer_code,
            max(whatsapp_evidence_facts_v17.customer_name) AS customer_name,
            max(whatsapp_evidence_facts_v17.customer_phone) AS customer_phone,
            array_agg(DISTINCT whatsapp_evidence_facts_v17.source_id) AS source_ids,
            array_agg(DISTINCT whatsapp_evidence_facts_v17.journey_id) FILTER (WHERE whatsapp_evidence_facts_v17.journey_id IS NOT NULL) AS journey_ids,
            min(whatsapp_evidence_facts_v17.fact_at) FILTER (WHERE whatsapp_evidence_facts_v17.fact_type = 'customer_request'::text) AS request_started_at,
            max(whatsapp_evidence_facts_v17.fact_at) AS last_event_at,
            count(*) FILTER (WHERE whatsapp_evidence_facts_v17.fact_type = 'customer_request'::text AND whatsapp_evidence_facts_v17.review_state <> 'rejected'::text) AS request_signals,
            count(*) FILTER (WHERE whatsapp_evidence_facts_v17.fact_type = 'promise_made'::text AND whatsapp_evidence_facts_v17.review_state <> 'rejected'::text) AS promises_made,
            count(*) FILTER (WHERE whatsapp_evidence_facts_v17.fact_type = 'delay_notice'::text AND whatsapp_evidence_facts_v17.review_state <> 'rejected'::text) AS delay_notices,
            count(*) FILTER (WHERE whatsapp_evidence_facts_v17.fact_type = 'customer_accepted_delay'::text AND whatsapp_evidence_facts_v17.review_state <> 'rejected'::text) AS customer_delay_acceptances,
            count(*) FILTER (WHERE whatsapp_evidence_facts_v17.fact_type = 'delivery_blocker'::text AND whatsapp_evidence_facts_v17.review_state <> 'rejected'::text) AS delivery_blockers,
            count(*) FILTER (WHERE whatsapp_evidence_facts_v17.fact_type = 'staff_handoff'::text AND whatsapp_evidence_facts_v17.review_state <> 'rejected'::text) AS staff_handoffs,
            count(*) FILTER (WHERE whatsapp_evidence_facts_v17.fact_type = 'promise_breach_signal'::text AND whatsapp_evidence_facts_v17.review_state <> 'rejected'::text) AS promise_breach_signals,
            count(*) FILTER (WHERE whatsapp_evidence_facts_v17.fact_type = 'recovery_offer'::text AND whatsapp_evidence_facts_v17.review_state <> 'rejected'::text) AS recovery_offers,
            count(*) FILTER (WHERE whatsapp_evidence_facts_v17.fact_type = 'case_continuity_break'::text AND whatsapp_evidence_facts_v17.review_state <> 'rejected'::text) AS continuity_break_signals,
            count(*) FILTER (WHERE whatsapp_evidence_facts_v17.fact_type = 'customer_silent'::text AND whatsapp_evidence_facts_v17.review_state <> 'rejected'::text) AS customer_silent_signals,
            count(*) FILTER (WHERE whatsapp_evidence_facts_v17.fact_type = 'verified_sale'::text AND whatsapp_evidence_facts_v17.review_state = 'confirmed'::text) AS verified_sales,
            array_agg(DISTINCT whatsapp_evidence_facts_v17.staff_name) FILTER (WHERE whatsapp_evidence_facts_v17.staff_name IS NOT NULL) AS staff_names,
            jsonb_agg(whatsapp_evidence_facts_v17.evidence_json ORDER BY whatsapp_evidence_facts_v17.fact_at DESC) FILTER (WHERE whatsapp_evidence_facts_v17.fact_type = 'promise_breach_signal'::text AND whatsapp_evidence_facts_v17.review_state <> 'rejected'::text) -> 0 AS breach_evidence
           FROM whatsapp_evidence_facts_v17
          WHERE EXISTS (SELECT 1 FROM whatsapp_operational_canonical_sources_v1 o WHERE o.source_id = whatsapp_evidence_facts_v17.source_id)
          GROUP BY (COALESCE(whatsapp_evidence_facts_v17.story_id::text, 'source:'::text || whatsapp_evidence_facts_v17.source_id::text)), whatsapp_evidence_facts_v17.story_id, whatsapp_evidence_facts_v17.branch, whatsapp_evidence_facts_v17.customer_id, whatsapp_evidence_facts_v17.customer_code
        )
 SELECT case_key,
    story_id,
    branch,
    customer_id,
    customer_code,
    customer_name,
    customer_phone,
    source_ids,
    journey_ids,
    request_started_at,
    last_event_at,
    request_signals,
    promises_made,
    delay_notices,
    customer_delay_acceptances,
    delivery_blockers,
    staff_handoffs,
    promise_breach_signals,
    recovery_offers,
    continuity_break_signals,
    customer_silent_signals,
    verified_sales,
    staff_names,
    breach_evidence,
        CASE
            WHEN verified_sales > 0 THEN 'verified_purchase'::text
            WHEN promise_breach_signals > 0 OR delivery_blockers > 0 THEN 'service_failure_needs_recovery'::text
            WHEN continuity_break_signals > 0 THEN 'continuity_review_needed'::text
            WHEN delay_notices > 0 AND customer_delay_acceptances > 0 THEN 'delay_acknowledged_by_customer'::text
            WHEN promises_made > 0 THEN 'promise_pending_verification'::text
            WHEN request_signals > 0 THEN 'request_open'::text
            ELSE 'context_only'::text
        END AS lifecycle_state,
        CASE
            WHEN verified_sales > 0 THEN 'لا إجراء استرجاع بسبب هذه الحالة؛ يوجد شراء مؤكد. راجع فقط رضا العميل إذا كان ذلك مناسبًا.'::text
            WHEN promise_breach_signals > 0 OR delivery_blockers > 0 THEN 'متابعة العميل حتى نتيجة واضحة، مع مراجعة سبب التعثر ومسؤولية كل مرحلة دون افتراض خطأ موظف بعينه.'::text
            WHEN continuity_break_signals > 0 THEN 'راجع تسليم الحالة بين الموظفين وأعد المتابعة من آخر نقطة معلومة بدل بدء حوار بلا سياق.'::text
            WHEN delay_notices > 0 AND customer_delay_acceptances > 0 THEN 'العميل وافق على التأخير، لكن يجب التحقق من التنفيذ النهائي وعدم اعتبار الموافقة إغلاقًا للطلب.'::text
            WHEN promises_made > 0 THEN 'تحقق من تنفيذ الوعد أو وجود فاتورة/تسليم قبل إغلاق الحالة.'::text
            ELSE 'راجع سياق الطلب قبل اتخاذ إجراء.'::text
        END AS next_operational_action,
        CASE
            WHEN promise_breach_signals > 0 OR delivery_blockers > 0 OR continuity_break_signals > 0 THEN true
            ELSE false
        END AS human_responsibility_review_required
   FROM f;

-- Evaluation coverage: operational sources only.
create or replace view public.whatsapp_source_evaluation_coverage_v17
with (security_invoker = true)
as
 WITH source_intent AS (
         SELECT s.id AS source_id,
            s.branch,
            s.staff_id,
            s.staff_name,
            s.customer_id,
            s.customer_code,
            s.customer_name,
            s.conversation_started_at,
            COALESCE(s.analysis_json #>> '{operational,primaryIntent}'::text[], s.analysis_json ->> 'sessionKind'::text, 'general_service'::text) AS primary_intent,
            s.analysis_confidence,
            s.review_status,
            s.reviewer_confirmed
           FROM whatsapp_review_sources s
          WHERE EXISTS (SELECT 1 FROM whatsapp_operational_canonical_sources_v1 o WHERE o.source_id = s.id)
        ), applicable AS (
         SELECT si.source_id,
            si.branch,
            si.staff_id,
            si.staff_name,
            si.customer_id,
            si.customer_code,
            si.customer_name,
            si.conversation_started_at,
            si.primary_intent,
            si.analysis_confidence,
            si.review_status,
            si.reviewer_confirmed,
            c.criterion_key,
            c.category,
            c.label_ar,
            c.description_ar,
            c.required_fact_types,
            c.supporting_fact_types,
            c.evidence_requirement,
            c.automation_level,
            c.sort_order
           FROM source_intent si
             CROSS JOIN whatsapp_evaluation_criteria_v17 c
          WHERE c.active AND (('all'::text = ANY (c.applies_to)) OR (si.primary_intent = ANY (c.applies_to)))
        ), factsets AS (
         SELECT whatsapp_evidence_facts_v17.source_id,
            array_agg(DISTINCT whatsapp_evidence_facts_v17.fact_type) FILTER (WHERE whatsapp_evidence_facts_v17.review_state <> 'rejected'::text) AS fact_types
           FROM whatsapp_evidence_facts_v17
          GROUP BY whatsapp_evidence_facts_v17.source_id
        )
 SELECT a.source_id,
    a.branch,
    a.staff_id,
    a.staff_name,
    a.customer_id,
    a.customer_code,
    a.customer_name,
    a.conversation_started_at,
    a.primary_intent,
    a.analysis_confidence,
    a.review_status,
    a.reviewer_confirmed,
    a.criterion_key,
    a.category,
    a.label_ar,
    a.description_ar,
    a.required_fact_types,
    a.supporting_fact_types,
    a.evidence_requirement,
    a.automation_level,
    a.sort_order,
        CASE
            WHEN cardinality(a.required_fact_types) = 0 THEN 'applicable'::text
            WHEN a.required_fact_types <@ COALESCE(f.fact_types, '{}'::text[]) THEN 'evidence_present'::text
            ELSE 'evidence_missing'::text
        END AS evidence_status,
    COALESCE(f.fact_types, '{}'::text[]) AS available_fact_types
   FROM applicable a
     LEFT JOIN factsets f USING (source_id);

-- Customer Story 360: every event stays visible as history and is tagged "operational";
-- the current open-action count uses operational sources only.
create or replace view public.whatsapp_customer_story_360_v1
with (security_invoker = true)
as
 SELECT id,
    story_key,
    branch,
    customer_id,
    customer_code,
    customer_name,
    customer_phone,
    status,
    risk_level,
    story_started_at,
    last_activity_at,
    recovery_started_at,
    recovered_at,
    recovered_invoice_id,
    recovered_invoice_number,
    recovered_invoice_value,
    last_verified_purchase_at,
    last_verified_purchase_value,
    open_request_count,
    open_complaint_count,
    accepted_recommendation_count,
    recovery_attempts,
    journey_count,
    source_count,
    summary,
    state_json,
    created_by,
    created_at,
    updated_at,
    COALESCE(( SELECT jsonb_agg(jsonb_build_object('event_type', e.event_type, 'event_at', e.event_at, 'title', e.title, 'detail', e.detail, 'product_name', e.product_name, 'invoice_number', e.invoice_number, 'invoice_value', e.invoice_value, 'source_id', e.source_id, 'journey_id', e.journey_id,
                'operational', e.source_id IS NULL OR EXISTS (SELECT 1 FROM whatsapp_operational_canonical_sources_v1 o WHERE o.source_id = e.source_id)) ORDER BY e.event_at DESC) AS jsonb_agg
           FROM ( SELECT whatsapp_customer_story_events.id,
                    whatsapp_customer_story_events.story_id,
                    whatsapp_customer_story_events.event_key,
                    whatsapp_customer_story_events.event_type,
                    whatsapp_customer_story_events.event_at,
                    whatsapp_customer_story_events.journey_id,
                    whatsapp_customer_story_events.source_id,
                    whatsapp_customer_story_events.action_id,
                    whatsapp_customer_story_events.staff_id,
                    whatsapp_customer_story_events.staff_name,
                    whatsapp_customer_story_events.product_id,
                    whatsapp_customer_story_events.product_code,
                    whatsapp_customer_story_events.product_name,
                    whatsapp_customer_story_events.invoice_id,
                    whatsapp_customer_story_events.invoice_number,
                    whatsapp_customer_story_events.invoice_value,
                    whatsapp_customer_story_events.confidence,
                    whatsapp_customer_story_events.title,
                    whatsapp_customer_story_events.detail,
                    whatsapp_customer_story_events.payload,
                    whatsapp_customer_story_events.created_at
                   FROM whatsapp_customer_story_events
                  WHERE whatsapp_customer_story_events.story_id = s.id
                  ORDER BY whatsapp_customer_story_events.event_at DESC
                 LIMIT 50) e), '[]'::jsonb) AS recent_events,
    COALESCE(( SELECT count(*) AS count
           FROM whatsapp_conversation_actions a
          WHERE (a.work_status IS NULL OR (a.work_status <> ALL (ARRAY['completed'::text, 'cancelled'::text, 'failed'::text]))) AND (s.customer_id IS NOT NULL AND a.customer_id = s.customer_id OR s.customer_code IS NOT NULL AND NULLIF(TRIM(BOTH FROM s.customer_code), ''::text) IS NOT NULL AND a.customer_code = s.customer_code AND dawaa_customer_request_branch_key(a.branch) = dawaa_customer_request_branch_key(s.branch) OR s.customer_phone IS NOT NULL AND NULLIF(regexp_replace(s.customer_phone, '\D'::text, ''::text, 'g'::text), ''::text) IS NOT NULL AND regexp_replace(COALESCE(a.customer_phone, ''::text), '\D'::text, ''::text, 'g'::text) = regexp_replace(s.customer_phone, '\D'::text, ''::text, 'g'::text) AND dawaa_customer_request_branch_key(a.branch) = dawaa_customer_request_branch_key(s.branch))
            AND EXISTS (SELECT 1 FROM whatsapp_operational_canonical_sources_v1 o WHERE o.source_id = a.source_id)), 0::bigint)::integer AS open_action_count
   FROM whatsapp_customer_stories s;

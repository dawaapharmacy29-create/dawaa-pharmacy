-- V22 envelopes are written by the browser persistence service. Sales Intelligence remains the
-- service-only owner of canonical sale proof and semantic projection.
ALTER TABLE public.whatsapp_customer_cases_v22 ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_customer_case_v22_select_v1 ON public.whatsapp_customer_cases_v22;
CREATE POLICY whatsapp_customer_case_v22_select_v1
ON public.whatsapp_customer_cases_v22
FOR SELECT
TO public
USING (
  (SELECT public.dawaa_current_actor_can(ARRAY['view_reviews','view_conversation_reviews','manage_conversation_evaluations']))
  AND root_source_id = ANY(source_ids)
  AND cardinality(source_ids) > 0
  AND EXISTS (
    SELECT 1
    FROM public.whatsapp_review_sources root_source
    WHERE root_source.id = root_source_id
      AND public.dawaa_customer_request_branch_key(root_source.branch)
        IS NOT DISTINCT FROM public.dawaa_customer_request_branch_key(whatsapp_customer_cases_v22.branch)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(source_ids) AS linked(source_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_review_sources source
      WHERE source.id = linked.source_id
        AND public.dawaa_can_read_conversation_review_row_v2(
          (SELECT public.dawaa_current_staff_account_id_strict()),
          source.staff_id,
          NULL::uuid,
          source.branch,
          NULL::uuid
        )
    )
  )
);

DROP POLICY IF EXISTS whatsapp_customer_case_v22_insert_v1 ON public.whatsapp_customer_cases_v22;
CREATE POLICY whatsapp_customer_case_v22_insert_v1
ON public.whatsapp_customer_cases_v22
FOR INSERT
TO public
WITH CHECK (
  (SELECT public.dawaa_current_actor_can(ARRAY['add_reviews','reviews.action.create','manage_conversation_evaluations']))
  AND (SELECT public.dawaa_current_actor_can(ARRAY['view_reviews','view_conversation_reviews','manage_conversation_evaluations']))
  AND root_source_id = ANY(source_ids)
  AND cardinality(source_ids) > 0
  AND EXISTS (
    SELECT 1
    FROM public.whatsapp_review_sources root_source
    WHERE root_source.id = root_source_id
      AND public.dawaa_customer_request_branch_key(root_source.branch)
        IS NOT DISTINCT FROM public.dawaa_customer_request_branch_key(whatsapp_customer_cases_v22.branch)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(source_ids) AS linked(source_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_review_sources source
      WHERE source.id = linked.source_id
        AND public.dawaa_can_read_conversation_review_row_v2(
          (SELECT public.dawaa_current_staff_account_id_strict()),
          source.staff_id,
          NULL::uuid,
          source.branch,
          NULL::uuid
        )
    )
  )
);

DROP POLICY IF EXISTS whatsapp_customer_case_v22_update_v1 ON public.whatsapp_customer_cases_v22;
CREATE POLICY whatsapp_customer_case_v22_update_v1
ON public.whatsapp_customer_cases_v22
FOR UPDATE
TO public
USING (
  (SELECT public.dawaa_current_actor_can(ARRAY['edit_reviews','approve_reviews','manage_conversation_evaluations']))
  AND (SELECT public.dawaa_current_actor_can(ARRAY['view_reviews','view_conversation_reviews','manage_conversation_evaluations']))
  AND root_source_id = ANY(source_ids)
  AND cardinality(source_ids) > 0
  AND EXISTS (
    SELECT 1
    FROM public.whatsapp_review_sources root_source
    WHERE root_source.id = root_source_id
      AND public.dawaa_customer_request_branch_key(root_source.branch)
        IS NOT DISTINCT FROM public.dawaa_customer_request_branch_key(whatsapp_customer_cases_v22.branch)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(source_ids) AS linked(source_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_review_sources source
      WHERE source.id = linked.source_id
        AND public.dawaa_can_read_conversation_review_row_v2(
          (SELECT public.dawaa_current_staff_account_id_strict()),
          source.staff_id,
          NULL::uuid,
          source.branch,
          NULL::uuid
        )
    )
  )
)
WITH CHECK (
  (SELECT public.dawaa_current_actor_can(ARRAY['edit_reviews','approve_reviews','manage_conversation_evaluations']))
  AND (SELECT public.dawaa_current_actor_can(ARRAY['view_reviews','view_conversation_reviews','manage_conversation_evaluations']))
  AND root_source_id = ANY(source_ids)
  AND cardinality(source_ids) > 0
  AND EXISTS (
    SELECT 1
    FROM public.whatsapp_review_sources root_source
    WHERE root_source.id = root_source_id
      AND public.dawaa_customer_request_branch_key(root_source.branch)
        IS NOT DISTINCT FROM public.dawaa_customer_request_branch_key(whatsapp_customer_cases_v22.branch)
  )
  AND NOT EXISTS (
    SELECT 1
    FROM unnest(source_ids) AS linked(source_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.whatsapp_review_sources source
      WHERE source.id = linked.source_id
        AND public.dawaa_can_read_conversation_review_row_v2(
          (SELECT public.dawaa_current_staff_account_id_strict()),
          source.staff_id,
          NULL::uuid,
          source.branch,
          NULL::uuid
        )
    )
  )
);

CREATE OR REPLACE FUNCTION public.dawaa_guard_whatsapp_customer_case_v22_browser_write_v1()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
DECLARE
  v_column text;
BEGIN
  IF current_user NOT IN ('anon', 'authenticated') THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.id := gen_random_uuid();
    NEW.created_at := now();
    IF NEW.verified_revenue IS NOT NULL
      OR NEW.verified_invoice_id IS NOT NULL
      OR NEW.verified_invoice_number IS NOT NULL
      OR NEW.verified_sale_at IS NOT NULL
      OR NEW.confirmed_outcome IS NOT NULL
      OR NEW.outcome_reviewed_by IS NOT NULL
      OR NEW.outcome_reviewed_at IS NOT NULL
      OR NEW.confirmed_lost_reason IS NOT NULL
      OR NEW.responsibility_status <> 'unreviewed'
      OR NEW.responsibility_note IS NOT NULL
      OR NEW.opportunity_value IS NOT NULL
      OR NEW.proposed_outcome = 'verified_sale'
      OR NEW.case_json ?| ARRAY['canonicalSaleProof', 'canonicalSemanticProjection']
    THEN
      RAISE EXCEPTION 'whatsapp_customer_case_v22_server_owned_fields'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - ARRAY[
    'updated_at', 'source_ids', 'story_id', 'journey_id', 'branch', 'customer_id',
    'customer_code', 'customer_name', 'customer_phone', 'case_type', 'case_state',
    'started_at', 'last_event_at', 'session_count', 'staff_account_ids', 'staff_names',
    'order_intent', 'order_confirmed', 'failure_detected', 'complaint_detected',
    'recommendation_detected', 'recovery_attempts', 'customer_reengaged',
    'media_referenced', 'media_available', 'media_missing', 'media_coverage_percent',
    'semantic_coverage', 'needs_human_review', 'next_action', 'summary', 'proposed_outcome',
    'outcome_confidence', 'outcome_evidence', 'proposed_lost_reason', 'lost_reason_confidence',
    'commercial_opportunity', 'case_json'
  ]) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY[
    'updated_at', 'source_ids', 'story_id', 'journey_id', 'branch', 'customer_id',
    'customer_code', 'customer_name', 'customer_phone', 'case_type', 'case_state',
    'started_at', 'last_event_at', 'session_count', 'staff_account_ids', 'staff_names',
    'order_intent', 'order_confirmed', 'failure_detected', 'complaint_detected',
    'recommendation_detected', 'recovery_attempts', 'customer_reengaged',
    'media_referenced', 'media_available', 'media_missing', 'media_coverage_percent',
    'semantic_coverage', 'needs_human_review', 'next_action', 'summary', 'proposed_outcome',
    'outcome_confidence', 'outcome_evidence', 'proposed_lost_reason', 'lost_reason_confidence',
    'commercial_opportunity', 'case_json'
  ]) THEN
    RAISE EXCEPTION 'whatsapp_customer_case_v22_server_owned_fields'
      USING ERRCODE = '42501';
  END IF;

  FOREACH v_column IN ARRAY ARRAY['canonicalSaleProof', 'canonicalSemanticProjection']
  LOOP
    IF (NEW.case_json -> v_column) IS DISTINCT FROM (OLD.case_json -> v_column) THEN
      RAISE EXCEPTION 'whatsapp_customer_case_v22_server_owned_case_json'
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS whatsapp_customer_case_v22_browser_write_guard_v1
  ON public.whatsapp_customer_cases_v22;
CREATE TRIGGER whatsapp_customer_case_v22_browser_write_guard_v1
BEFORE INSERT OR UPDATE ON public.whatsapp_customer_cases_v22
FOR EACH ROW
EXECUTE FUNCTION public.dawaa_guard_whatsapp_customer_case_v22_browser_write_v1();

-- PostgREST requires table-level INSERT/UPDATE privileges. The row policies scope records, while
-- the trigger above enforces the envelope-only field contract for browser roles.
REVOKE ALL PRIVILEGES ON TABLE public.whatsapp_customer_cases_v22 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.whatsapp_customer_cases_v22 TO anon, authenticated;
GRANT INSERT, UPDATE ON TABLE public.whatsapp_customer_cases_v22 TO anon, authenticated;

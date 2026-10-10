\ir ../staging/00_platform_shim.sql

CREATE TABLE public.staff_accounts (
  id uuid PRIMARY KEY,
  staff_id text,
  role text,
  branch text,
  active boolean NOT NULL DEFAULT false,
  can_login boolean NOT NULL DEFAULT false,
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.whatsapp_review_sources (
  id uuid PRIMARY KEY,
  staff_id uuid,
  branch text
);

CREATE OR REPLACE FUNCTION public.dawaa_customer_request_branch_key(p_branch text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(lower(trim(p_branch)), '')
$$;

\ir ../staging/30_session_helpers.sql

ALTER TABLE public.whatsapp_review_sources ENABLE ROW LEVEL SECURITY;
CREATE POLICY whatsapp_review_sources_select_fixture
ON public.whatsapp_review_sources
FOR SELECT
TO public
USING (
  public.dawaa_current_actor_can(ARRAY['view_reviews','view_conversation_reviews','manage_conversation_evaluations'])
  AND public.dawaa_can_read_conversation_review_row_v2(
    public.dawaa_current_staff_account_id_strict(),
    staff_id,
    NULL::uuid,
    branch,
    NULL::uuid
  )
);
GRANT SELECT ON public.whatsapp_review_sources TO anon, authenticated;

CREATE TABLE public.whatsapp_customer_cases_v22 (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_key text NOT NULL UNIQUE,
  root_source_id uuid NOT NULL,
  source_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  story_id uuid,
  journey_id uuid,
  branch text,
  customer_id uuid,
  customer_code text,
  customer_name text,
  customer_phone text,
  case_type text NOT NULL,
  case_state text NOT NULL,
  started_at timestamptz NOT NULL,
  last_event_at timestamptz NOT NULL,
  session_count integer NOT NULL DEFAULT 1,
  staff_account_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  staff_names text[] NOT NULL DEFAULT '{}'::text[],
  order_intent boolean NOT NULL DEFAULT false,
  order_confirmed boolean NOT NULL DEFAULT false,
  failure_detected boolean NOT NULL DEFAULT false,
  complaint_detected boolean NOT NULL DEFAULT false,
  recommendation_detected boolean NOT NULL DEFAULT false,
  recovery_attempts integer NOT NULL DEFAULT 0,
  customer_reengaged boolean NOT NULL DEFAULT false,
  media_referenced integer NOT NULL DEFAULT 0,
  media_available integer NOT NULL DEFAULT 0,
  media_missing integer NOT NULL DEFAULT 0,
  media_coverage_percent numeric NOT NULL DEFAULT 100,
  semantic_coverage text NOT NULL DEFAULT 'full_text',
  needs_human_review boolean NOT NULL DEFAULT false,
  next_action text,
  summary text,
  proposed_outcome text,
  outcome_confidence numeric,
  outcome_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  proposed_lost_reason text,
  lost_reason_confidence numeric,
  commercial_opportunity boolean NOT NULL DEFAULT false,
  case_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  verified_invoice_id text,
  verified_invoice_number text,
  verified_revenue numeric,
  verified_sale_at timestamptz,
  confirmed_outcome text,
  outcome_reviewed_by text,
  outcome_reviewed_at timestamptz,
  confirmed_lost_reason text,
  responsibility_status text NOT NULL DEFAULT 'unreviewed',
  responsibility_note text,
  opportunity_value numeric
);

INSERT INTO public.staff_accounts (id, staff_id, role, branch, active, can_login) VALUES
  ('00000000-0000-4000-8000-0000000000a1', 'SYN-S1', 'customer_service', 'فرع شكري', true, true),
  ('00000000-0000-4000-8000-0000000000a3', 'SYN-S3', 'customer_service', 'فرع الشامي', true, true),
  ('00000000-0000-4000-8000-0000000000a4', 'SYN-S4', 'branch_manager', 'فرع شكري', false, false);

INSERT INTO public.whatsapp_review_sources (id, staff_id, branch) VALUES
  ('00000000-0000-4000-8000-000000000051', '00000000-0000-4000-8000-0000000000a1', 'فرع شكري'),
  ('00000000-0000-4000-8000-000000000052', '00000000-0000-4000-8000-0000000000a3', 'فرع الشامي');

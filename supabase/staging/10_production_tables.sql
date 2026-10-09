-- STAGING BOOTSTRAP 10 — tables the Release Candidate migrations assume (classification: table dependency).
-- These tables exist in Production but have no CREATE TABLE in supabase/migrations (the repo chain
-- cannot build them from zero). Column sets come from, in order of authority:
--   L = live-mirrored repo fixtures (supabase/tests/*.fixture.sql, read from Production on 2026-10-08)
--   S = supabase/sql/supabase-setup.sql
--   M = columns the repo migrations and the app reference (triggers, indexes, views, RPC bodies)
-- Only columns the migrations, regression suites and reconciliation touch are present. A real staging
-- project must instead be seeded with a SCHEMA-ONLY export of Production (no rows); see
-- docs/si-operational-audit-20261009/staging-preview-gate.md. No data here.

-- Identity (L) -------------------------------------------------------------------------------
create table public.staff_accounts (
  id uuid primary key, staff_id text, username text, name text, staff_name text, role text, staff_role text, branch text,
  active boolean, is_active boolean, can_login boolean, status text, auth_user_id uuid,
  permissions jsonb default '{}'::jsonb, created_at timestamptz default now(), updated_at timestamptz);
create table public.staff_login_sessions (
  id uuid primary key default gen_random_uuid(), staff_account_id uuid references public.staff_accounts(id),
  token_hash text not null, created_at timestamptz default now(), expires_at timestamptz not null,
  last_used_at timestamptz, revoked_at timestamptz);
create table public.staff (id uuid primary key, name text, role text, branch text, branch_id uuid, active boolean, is_active boolean);

create table public.customers (
  id uuid primary key, customer_code text, effective_customer_code text, code text, name text, display_name text,
  customer_name text, branch text, effective_branch text, is_duplicate boolean, normalized_phone text, phone text,
  customer_phone text, mobile text, whatsapp_phone text, whatsapp text, phone_alt text, updated_at timestamptz);
create table public.customer_metrics_summary (customer_code text, branch text, last_purchase timestamptz);

-- Follow-ups (S + L + M) -----------------------------------------------------------------------
create table public.daily_followups (
  id text primary key default gen_random_uuid()::text,
  date text, followup_date date, followup_day date, followup_datetime timestamptz,
  customer_id text, customer_code text, customer_name text, name text, customer_phone text, phone text, branch text,
  status text, followup_status text, contact_status text, followup_type text, category text,
  priority text, followup_reason text, suggested_action text,
  request_type text, request_details text, request_status text, notes text, followup_notes text,
  assigned_to text, responsible_name text, assigned_doctor text, next_followup_date date,
  created_by text, created_by_name text, requested_by_staff_id text, request_source text,
  identity_key text, canonical_followup_id text, client_request_id text,
  is_hidden boolean default false, is_duplicate boolean default false, duplicate_of text,
  hidden_at timestamptz, hidden_by text, hidden_reason text, archived_at timestamptz, archive_reason text,
  completed_at timestamptz, completed_by text, cancelled_at timestamptz, cancelled_by text, cancelled_reason text,
  postponed_until timestamptz, attempt_count integer, last_attempt_at timestamptz, contacted_at timestamptz,
  followup_result text, contact_result text, evaluation_summary text, evaluation_score numeric,
  customer_metrics jsonb, data_quality_status text, data_issues text[] default '{}'::text[], open_case boolean default true,
  created_at timestamptz default clock_timestamp(), updated_at timestamptz, updated_by text);
create table public.customer_service_daily_queue_items (
  id text primary key default gen_random_uuid()::text, customer_id text, customer_code text, customer_phone text, branch text,
  linked_followup_id text, queue_date date, status text, completed_at timestamptz, updated_at timestamptz, metadata jsonb);
create table public.customer_service_followup_events (
  id uuid primary key default gen_random_uuid(), followup_id text, event_type text, event_status text,
  actor_staff_id text, actor_name text, notes text, metadata jsonb, created_at timestamptz default clock_timestamp());
create table public.customer_followup_events (
  id uuid primary key default gen_random_uuid(), followup_id text, customer_id text, customer_code text,
  event_type text, old_status text, new_status text, event_note text, event_payload jsonb,
  branch text, actor_id text, actor_name text, created_at timestamptz default clock_timestamp());
create table public.customer_followup_audit_log (
  id uuid primary key default gen_random_uuid(), followup_id text, customer_id text, action text,
  actor_staff_id text, actor_name text, branch text, metadata jsonb, created_at timestamptz default now());
create table public.customer_branch_overrides (
  id uuid primary key default gen_random_uuid(), customer_code text, customer_id text, customer_phone text,
  customer_name text, old_branch text, new_branch text, suggested_branch text, reason text,
  created_by text, created_by_name text, active boolean, created_at timestamptz default now());

-- WhatsApp review and operations (L) ---------------------------------------------------------
create table public.whatsapp_review_sources (
  id uuid primary key, staff_id uuid, branch text, source_filename text, conversation_started_at timestamptz,
  conversation_ended_at timestamptz, raw_text text, customer_id uuid);
create table public.whatsapp_operational_canonical_sources_v1 (source_id uuid primary key);
create table public.whatsapp_conversation_actions (
  id uuid primary key, source_id uuid references public.whatsapp_review_sources(id), action_key text, action_type text,
  followup_identity text, customer_id uuid, customer_code text, customer_name text, customer_phone text,
  staff_id uuid, product_id uuid, quantity numeric, confidence numeric, auto_eligible boolean, payload jsonb, evidence jsonb,
  updated_at timestamptz, due_at timestamptz, completed_at timestamptz, recovered_at timestamptz, recovered_invoice_value numeric,
  branch text, created_by text, last_error text, outcome text, outcome_note text, product_code text, product_name text,
  reason text, recovered_invoice_id text, recovered_invoice_number text, staff_name text, status text,
  target_id text, target_table text, work_status text, created_at timestamptz default now(),
  unique (source_id, action_key));
create table public.whatsapp_auto_followup_requests (
  id uuid primary key, followup_identity text, customer_id uuid, customer_code text, customer_name text, customer_phone text,
  customer_identity_status text, branch text, source_file_name text, conversation_session_id text, signal_type text,
  requested_product_name text, evidence_timestamp timestamptz, evidence_quote text, status text);
create table public.whatsapp_review_audit (
  id uuid primary key default gen_random_uuid(), source_id uuid not null references public.whatsapp_review_sources(id),
  action text, actor_id text, actor_name text, actor_role text, before_state jsonb, after_state jsonb, note text,
  created_at timestamptz default now());
create table public.whatsapp_customer_stories (id uuid primary key, story_key text);
create table public.whatsapp_customer_story_events (
  id uuid primary key default gen_random_uuid(), story_id uuid references public.whatsapp_customer_stories(id), event_key text);
create table public.whatsapp_customer_journeys (id uuid primary key, root_source_id uuid, story_id uuid references public.whatsapp_customer_stories(id));
create table public.whatsapp_customer_journey_sessions (journey_id uuid, source_id uuid, primary key (journey_id, source_id));
create table public.whatsapp_evidence_facts_v17 (
  id uuid primary key default gen_random_uuid(), source_id uuid references public.whatsapp_review_sources(id),
  journey_id uuid references public.whatsapp_customer_journeys(id), story_id uuid references public.whatsapp_customer_stories(id),
  fact_key text, updated_at timestamptz, unique (source_id, fact_key));
create table public.whatsapp_sales_opportunities_v17 (
  id uuid primary key default gen_random_uuid(), root_source_id uuid references public.whatsapp_review_sources(id),
  journey_id uuid references public.whatsapp_customer_journeys(id), story_id uuid references public.whatsapp_customer_stories(id),
  opportunity_key text, current_stage text, matched_invoice_id text, matched_invoice_number text, product_id uuid,
  product_code text, product_name text, customer_id uuid, customer_code text, branch text, opened_at timestamptz,
  last_stage_at timestamptz, updated_at timestamptz, unique (root_source_id, opportunity_key));
create table public.whatsapp_customer_cases_v22 (id uuid primary key default gen_random_uuid(), updated_at timestamptz);

-- Sales Intelligence and reviews (L + M) -------------------------------------------------------
create table public.sales_intelligence_cases (
  case_id text primary key, conversation_id uuid, is_active boolean default false, retired_at timestamptz, retire_reason text);
create table public.sales_intelligence_current_case_analyses (case_id text primary key);
create table public.sales_invoice_items_v21 (
  id uuid primary key default gen_random_uuid(), invoice_id text, invoice_number text, branch text, invoice_date timestamptz,
  customer_id uuid, customer_code text, product_id uuid, product_code text, product_name text, quantity numeric, line_total numeric);
create table public.conversation_sales_reviews (
  id uuid not null default gen_random_uuid() primary key,
  reviewer_id uuid, reviewer_name text, reviewer_role text, staff_id uuid, staff_name text, staff_role text, branch text,
  customer_id text, customer_name text, customer_code text, customer_phone text, evaluation_kind text, invoice_number text,
  invoice_time timestamp without time zone, evaluation_reason text, total_score numeric, raw_scores jsonb,
  has_complaint boolean default false, has_medical_error boolean default false, has_invoice_error boolean default false,
  reviewer_notes text, training_recommendation text, final_score numeric, point_impact numeric,
  impact_status text default 'approved'::text, reviewed_at timestamptz default now(), created_at timestamptz default now(),
  base_score numeric default 100, positive_points numeric default 0, negative_points numeric default 0,
  severe_error_points numeric default 0, doctor_points_impact numeric default 0, conversation_level text,
  top_positive_reason text, top_deduction_reason text, forgotten_customer boolean default false,
  missed_sale_opportunity boolean default false, has_critical_error boolean default false, repeated_error_type text,
  repeat_count integer default 0, repeat_multiplier numeric default 1, month_cycle text, doctor_id uuid, branch_id uuid,
  conversation_date timestamptz, conversation_type text, level text, base_points_impact numeric default 0,
  extra_penalty_points numeric default 0, total_applicable_items integer default 0, total_not_applicable_items integer default 0,
  total_applicable_points numeric default 0, earned_points numeric default 0, main_positive_reason text,
  main_negative_reason text, review_items jsonb default '[]'::jsonb, first_customer_message_at timestamptz,
  first_staff_reply_at timestamptz, first_response_minutes integer, response_speed_score numeric, greeting_score numeric,
  greeting_message_used text, doctor_name_used_in_greeting boolean default false, doctor_name_used boolean default false,
  doctor_name_score numeric, customer_name_used boolean default false, customer_name_score numeric,
  tone_language_score numeric, bad_tone_flag boolean default false, severe_bad_tone_flag boolean default false,
  understanding_score numeric, rushed_response_flag boolean default false, misunderstood_customer_flag boolean default false,
  follow_up_promised boolean default false, follow_up_delay_minutes integer, follow_up_score numeric,
  consultation_quality_score numeric, dosage_explanation_score numeric, alternative_handling_score numeric,
  bad_alternative_flag boolean default false, sales_quality_score numeric, upsell_cross_sell_score numeric,
  successful_cross_sell boolean default false, complaint_handling_score numeric, handled_angry_customer_well boolean default false,
  excellent_case boolean default false, order_confirmation_score numeric, has_delivery_issue boolean default false,
  missed_sales_opportunity boolean default false, closing_message_score numeric, closing_message_used boolean default false,
  updated_at timestamptz default now(), doctor_name text, review_date date, reviewer_message text,
  manager_review_score numeric, manager_review_notes text, manager_reviewed_by text, manager_reviewed_at timestamptz,
  converted_to_sale boolean, submission_fingerprint text,
  whatsapp_review_source_id uuid references public.whatsapp_review_sources(id),
  sales_intelligence_case_id text, automatic_evaluation_version text, automatic_evaluation_json jsonb,
  evidence_coverage_percent numeric, automatic_reliability_percent numeric, manual_clinical_review_required boolean,
  is_current boolean not null default true, superseded_at timestamptz, superseded_reason text);
create unique index ux_conversation_review_submission_fingerprint_v2 on public.conversation_sales_reviews (submission_fingerprint) where submission_fingerprint is not null;
create unique index idx_conversation_reviews_unique_submission on public.conversation_sales_reviews (staff_name, customer_name, conversation_date, reviewer_name) where conversation_date is not null;
create unique index conversation_sales_reviews_whatsapp_source_legacy_uk on public.conversation_sales_reviews (whatsapp_review_source_id) where whatsapp_review_source_id is not null and sales_intelligence_case_id is null;
create unique index conversation_sales_reviews_whatsapp_case_uk on public.conversation_sales_reviews (whatsapp_review_source_id, sales_intelligence_case_id) where whatsapp_review_source_id is not null and sales_intelligence_case_id is not null;

-- RLS hardening targets (M: names only; the migration enables RLS and adds one read policy) --------
create table public.notification_sla_policies (id uuid primary key default gen_random_uuid());
create table public.sales_import_bridge_tokens_20260908 (id uuid primary key default gen_random_uuid());
create table public.task_activity_log (id uuid primary key default gen_random_uuid());

-- Customer requests (M) ------------------------------------------------------------------------
create table public.customer_requests (id uuid primary key default gen_random_uuid(), branch text, customer_id uuid, status text);
create table public.customer_request_events (id uuid primary key default gen_random_uuid(), request_id uuid, event_type text);

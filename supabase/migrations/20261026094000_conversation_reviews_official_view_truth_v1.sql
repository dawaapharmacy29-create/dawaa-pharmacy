-- conversation_sales_reviews_official_v1 becomes truly "official". NOT APPLIED automatically.
--
-- Production (2026-10-26, read-only): the view only filtered canonical-source membership, so it
-- returned superseded and reversed rows and unapproved automatic analyses. It is the single SQL source for 13 functions and one
-- view, two of them on money paths:
--   calculate_weekly_manager_metrics(_v2) -> manager_weekly_evaluations.auto_metrics -> settlement
--   get_doctor_incentive_breakdown
-- plus get_cs_dashboard_reviews, get_cs_manager_supporting_metrics_v1,
-- get_doctor_competition_support_v1, get_doctor_conversation_conversion_summary_v1,
-- get_branch_conversation_conversion_summary_v1, get_doctor_conversation_quality_summary,
-- get_doctor_conversation_review_coverage, get_doctor_cycle_reviews_v1,
-- get_doctor_today_review_count, get_manager_doctor_alerts and employee_kpi_30d_summary.
--
-- Same predicate as public.dawaa_conversation_review_is_official_v1 and
-- src/lib/evaluations/officialConversationReview.ts (quality evidence: a human review counts as
-- written; its impact_status gates only its points). Column list, security_invoker and grants are
-- unchanged, so every dependent keeps compiling. Behaviour change (intended): automatic unapproved,
-- superseded and reversed reviews no longer appear in those readers.
--
-- Rollback: re-create the view with the same column list and only the canonical-source predicate
-- (the WHERE clause below without the official conditions).

create or replace view public.conversation_sales_reviews_official_v1
with (security_invoker = true) as
select id, reviewer_id, reviewer_name, reviewer_role, staff_id, staff_name, staff_role, branch,
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
where (r.whatsapp_review_source_id is null
    or exists (select 1 from public.whatsapp_operational_canonical_sources_v1 o
               where o.source_id = r.whatsapp_review_source_id))
  and coalesce(r.is_current, true)
  and r.superseded_at is null
  and lower(coalesce(r.impact_status, '')) not in ('reversed', 'rejected', 'cancelled')
  and (
    (r.automatic_evaluation_version is null and lower(coalesce(r.evaluation_kind, '')) <> 'automatic')
    or (r.manager_reviewed_at is not null and nullif(btrim(coalesce(r.manager_reviewed_by::text, '')), '') is not null)
  );

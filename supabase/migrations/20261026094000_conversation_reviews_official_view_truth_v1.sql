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

-- Restore the two manager-evaluation SQL consumers to the same business-event
-- date as the official review contract. Only their review window is changed;
-- all other week metrics and the existing function security/grants stay intact.
-- A review entered after midnight must not migrate to the entry-day cycle.

CREATE OR REPLACE FUNCTION public.calculate_weekly_manager_metrics(p_evaluation_type text, p_branch text, p_week_start date, p_week_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
  v_this_quarter_sales numeric;
  v_sales numeric;
  v_purchases numeric;
  v_purchases_count integer;
  v_inventory_due integer;
  v_inventory_closed_on_time integer;
  v_inventory_overdue integer;
  v_followups_total integer;
  v_followups_expired integer;
  v_followups_closed integer;
  v_late_minutes numeric;
  v_missing_punch integer;
  v_active_customers integer;
  v_vip_customers integer;
  v_vip_still_active integer;
  v_reviews_count integer;
  v_reviews_avg_score numeric;
  v_points_tx_total integer;
  v_points_tx_contacted integer;
  v_new_customers integer;
begin
  select coalesce(sum(coalesce(net_amount, net_total, amount, total_amount, 0)), 0)
    into v_sales
  from public.dawaa_sales_invoices_dashboard_v1
  where invoice_date between p_week_start and p_week_end
    and (p_branch is null or branch = p_branch);

  select coalesce(sum(coalesce(total_value,0)-coalesce(returned_value,0)), 0), count(*)
    into v_purchases, v_purchases_count
  from public.purchase_invoices
  where invoice_date between p_week_start and p_week_end
    and (p_branch is null or branch = p_branch);

  select count(*) filter (where due_date between p_week_start and p_week_end),
         count(*) filter (where due_date between p_week_start and p_week_end and status = 'closed' and closed_at::date <= due_date),
         count(*) filter (where due_date between p_week_start and p_week_end and (status <> 'closed' or closed_at::date > due_date))
    into v_inventory_due, v_inventory_closed_on_time, v_inventory_overdue
  from inventory_count_sessions
  where (p_branch is null or branch = p_branch);

  select count(*),
         count(*) filter (where closed_at is null and coalesce(open_case, true) and created_at <= p_week_end + interval '1 day' - interval '48 hours'),
         count(*) filter (where closed_at is not null and closed_at::date between p_week_start and p_week_end)
    into v_followups_total, v_followups_expired, v_followups_closed
  from daily_followups
  where created_at::date between p_week_start and p_week_end
    and (p_branch is null or branch = p_branch);

  select coalesce(sum(late_minutes), 0), count(*) filter (where missing_punch)
    into v_late_minutes, v_missing_punch
  from attendance_daily_summary
  where attendance_date between p_week_start and p_week_end
    and (p_branch is null or branch = p_branch);

  select count(*) filter (where last_purchase >= p_week_start - interval '60 days'),
         count(*) filter (where coalesce(avg_monthly,0) >= 2000),
         count(*) filter (where coalesce(avg_monthly,0) >= 2000 and last_purchase >= p_week_start - interval '30 days')
    into v_active_customers, v_vip_customers, v_vip_still_active
  from customer_metrics_summary
  where (p_branch is null or branch = p_branch);

  -- جودة تقييم المحادثات: عدد المراجعات + متوسط الدرجة خلال الأسبوع
  select count(*), coalesce(avg(final_score), null)
    into v_reviews_count, v_reviews_avg_score
  from conversation_sales_reviews_official_v1
  where coalesce((conversation_date at time zone 'Africa/Cairo')::date,
                 review_date,
                 (created_at at time zone 'Africa/Cairo')::date)
        between p_week_start and p_week_end
    and (p_branch is null or branch = p_branch);

  -- متابعة نقاط العملاء وإبلاغهم: نسبة معاملات النقاط اللي اتبلّغ فيها العميل فعليًا
  select count(*), count(*) filter (where contacted is true)
    into v_points_tx_total, v_points_tx_contacted
  from customer_points_ledger
  where created_at::date between p_week_start and p_week_end
    and (p_branch is null or branch = p_branch);

  -- نمو عدد العملاء: عملاء جدد أول شراء ليهم وقع في الأسبوع ده
  select count(*)
    into v_new_customers
  from customer_metrics_summary
  where first_purchase between p_week_start and p_week_end
    and (p_branch is null or branch = p_branch);

  v_result := jsonb_build_object(
    'sales_total', v_sales,
    'purchases_total', v_purchases,
    'purchases_count', v_purchases_count,
    'inventory_sessions_due', v_inventory_due,
    'inventory_closed_on_time', v_inventory_closed_on_time,
    'inventory_overdue', v_inventory_overdue,
    'followups_total', v_followups_total,
    'followups_expired', v_followups_expired,
    'followups_closed', v_followups_closed,
    'attendance_late_minutes', v_late_minutes,
    'attendance_missing_punch', v_missing_punch,
    'active_customers', v_active_customers,
    'vip_customers', v_vip_customers,
    'vip_customers_still_active', v_vip_still_active,
    'vip_retention_rate', case when v_vip_customers > 0 then round((v_vip_still_active::numeric / v_vip_customers) * 100, 1) else null end,
    'conversation_reviews_count', v_reviews_count,
    'conversation_reviews_avg_score', round(v_reviews_avg_score, 1),
    'points_transactions_total', v_points_tx_total,
    'points_transactions_contacted', v_points_tx_contacted,
    'new_customers_count', v_new_customers
  );

  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.calculate_weekly_manager_metrics_v2(p_evaluation_type text, p_branch text, p_week_start date, p_week_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_result jsonb;
  v_sales numeric:=0; v_sales_count int:=0; v_coded_sales int:=0; v_target numeric:=0;
  v_purchases numeric:=0; v_purchases_count int:=0;
  v_inventory_due int:=0; v_inventory_closed int:=0; v_inventory_overdue int:=0;
  v_followups_total int:=0; v_followups_expired int:=0; v_followups_closed int:=0; v_followups_purchase numeric:=0;
  v_attendance_days int:=0; v_late_minutes numeric:=0; v_missing_punch int:=0;
  v_active_customers int:=0; v_vip_customers int:=0; v_vip_active int:=0; v_new_customers int:=0;
  v_reviews_count int:=0; v_reviews_avg numeric;
  v_points_total int:=0; v_points_contacted int:=0;
  v_requests_total int:=0; v_requests_closed int:=0; v_requests_on_time int:=0; v_requests_overdue int:=0;
  v_shift_total int:=0; v_shift_completed int:=0; v_shift_overdue int:=0;
  v_from_ts timestamp;
  v_to_ts timestamp;
begin
  if p_week_start is null or p_week_end is null or p_week_end<p_week_start then
    raise exception 'invalid manager metrics period';
  end if;
  if p_evaluation_type not in ('branch_manager','branches_manager','customer_service') then
    raise exception 'invalid evaluation type';
  end if;

  v_from_ts := p_week_start::timestamp;
  v_to_ts := (p_week_end + 1)::timestamp;

  select coalesce(sum(coalesce(net_amount,net_total,amount,total_amount,0)),0),count(*),
    count(*) filter(where customer_id is not null or nullif(btrim(customer_code),'') is not null)
  into v_sales,v_sales_count,v_coded_sales
  from public.dawaa_sales_invoices_dashboard_v1
  where invoice_date >= v_from_ts and invoice_date < v_to_ts
    and (p_branch is null or branch=p_branch);

  select coalesce(sum(target_amount*greatest(0,least(cycle_end,p_week_end)-greatest(cycle_start,p_week_start)+1)::numeric/greatest(1,cycle_end-cycle_start+1)),0)
  into v_target
  from public.branch_sales_targets_v13
  where cycle_end>=p_week_start and cycle_start<=p_week_end and (p_branch is null or branch=p_branch);

  select coalesce(sum(coalesce(total_value,0)-coalesce(returned_value,0)),0),count(*)
  into v_purchases,v_purchases_count
  from public.purchase_invoices
  where invoice_date>=p_week_start and invoice_date<=p_week_end and (p_branch is null or branch=p_branch);

  select count(*) filter(where due_date between p_week_start and p_week_end),
    count(*) filter(where due_date between p_week_start and p_week_end and status='closed' and closed_at::date<=due_date),
    count(*) filter(where due_date between p_week_start and p_week_end and (status<>'closed' or closed_at::date>due_date))
  into v_inventory_due,v_inventory_closed,v_inventory_overdue
  from public.inventory_count_sessions
  where p_branch is null or branch=p_branch;

  select count(*),
    count(*) filter(where closed_at is null and coalesce(open_case,true) and created_at<=v_to_ts-interval '48 hours'),
    count(*) filter(where closed_at is not null and closed_at>=v_from_ts and closed_at<v_to_ts),
    coalesce(sum(coalesce(purchase_amount,0)) filter(where coalesce(purchase_after_followup,false)),0)
  into v_followups_total,v_followups_expired,v_followups_closed,v_followups_purchase
  from public.daily_followups
  where created_at>=v_from_ts and created_at<v_to_ts and (p_branch is null or branch=p_branch);

  select count(*),coalesce(sum(late_minutes),0),count(*) filter(where missing_punch)
  into v_attendance_days,v_late_minutes,v_missing_punch
  from public.attendance_daily_summary
  where attendance_date>=p_week_start and attendance_date<=p_week_end and (p_branch is null or branch=p_branch);

  select count(*) filter(where last_purchase>=p_week_start-interval '60 days'),
    count(*) filter(where coalesce(avg_monthly,0)>=2000),
    count(*) filter(where coalesce(avg_monthly,0)>=2000 and last_purchase>=p_week_start-interval '30 days'),
    count(*) filter(where first_purchase between p_week_start and p_week_end)
  into v_active_customers,v_vip_customers,v_vip_active,v_new_customers
  from public.customer_metrics_summary
  where p_branch is null or branch=p_branch;

  select count(*),avg(final_score)
  into v_reviews_count,v_reviews_avg
  from public.conversation_sales_reviews_official_v1
  where coalesce((conversation_date at time zone 'Africa/Cairo')::date,
                 review_date,
                 (created_at at time zone 'Africa/Cairo')::date)
        between p_week_start and p_week_end
    and (p_branch is null or branch=p_branch);

  select count(*),count(*) filter(where contacted is true)
  into v_points_total,v_points_contacted
  from public.customer_points_ledger
  where created_at>=v_from_ts and created_at<v_to_ts and (p_branch is null or branch=p_branch);

  select count(*),count(*) filter(where status in ('delivered','completed','closed')),
    count(*) filter(where status in ('delivered','completed','closed') and (due_date is null or closed_at::date<=due_date)),
    count(*) filter(where status not in ('delivered','completed','closed','cancelled') and coalesce(due_date,created_at::date+2)<p_week_end)
  into v_requests_total,v_requests_closed,v_requests_on_time,v_requests_overdue
  from public.customer_requests
  where created_at>=v_from_ts and created_at<v_to_ts and (p_branch is null or branch=p_branch);

  select count(*),count(*) filter(where status='completed'),
    count(*) filter(where status not in ('completed','cancelled') and created_at<v_to_ts-interval '48 hours')
  into v_shift_total,v_shift_completed,v_shift_overdue
  from public.shift_notes
  where created_at>=v_from_ts and created_at<v_to_ts and (p_branch is null or branch=p_branch);

  v_result:=jsonb_build_object(
    'sales_total',v_sales,'sales_invoices_count',v_sales_count,'coded_sales_invoices_count',v_coded_sales,
    'sales_coding_rate',case when v_sales_count>0 then round(v_coded_sales::numeric/v_sales_count*100,1) end,
    'sales_target_amount',v_target,'sales_target_achievement_rate',case when v_target>0 then round(v_sales/v_target*100,1) end,
    'purchases_total',v_purchases,'purchases_count',v_purchases_count,
    'inventory_sessions_due',v_inventory_due,'inventory_closed_on_time',v_inventory_closed,'inventory_overdue',v_inventory_overdue,
    'followups_total',v_followups_total,'followups_expired',v_followups_expired,'followups_closed',v_followups_closed,'followups_purchase_amount',v_followups_purchase,
    'attendance_days_count',v_attendance_days,'attendance_late_minutes',v_late_minutes,'attendance_missing_punch',v_missing_punch,
    'active_customers',v_active_customers,'vip_customers',v_vip_customers,'vip_customers_still_active',v_vip_active,
    'vip_retention_rate',case when v_vip_customers>0 then round(v_vip_active::numeric/v_vip_customers*100,1) end,
    'conversation_reviews_count',v_reviews_count,'conversation_reviews_avg_score',round(v_reviews_avg,1),
    'points_transactions_total',v_points_total,'points_transactions_contacted',v_points_contacted,'new_customers_count',v_new_customers,
    'customer_requests_total',v_requests_total,'customer_requests_closed',v_requests_closed,
    'customer_requests_closed_on_time',v_requests_on_time,'customer_requests_overdue',v_requests_overdue,
    'shift_notes_total',v_shift_total,'shift_notes_completed',v_shift_completed,'shift_notes_overdue',v_shift_overdue,
    'data_coverage',jsonb_build_object('sales',v_sales_count>0,'targets',v_target>0,'purchases',v_purchases_count>0,'inventory',v_inventory_due>0,
      'followups',v_followups_total>0,'attendance',v_attendance_days>0,'customers',v_active_customers>0,'reviews',v_reviews_count>0,
      'points',v_points_total>0,'customer_requests',v_requests_total>0,'shift_notes',v_shift_total>0));
  return v_result;
end;
$function$;

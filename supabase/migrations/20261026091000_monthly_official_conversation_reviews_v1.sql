-- Monthly evaluation consumes OFFICIAL conversation reviews only, dated by the operational
-- conversation day on the Cairo calendar. NOT APPLIED automatically.
--
-- Mirrors src/lib/evaluations/officialConversationReview.ts (classifyConversationReview):
--   * current (is_current is not false), not superseded, not reversed/rejected/cancelled;
--   * a human review by an authorized reviewer counts as written (no general-manager review);
--     its impact_status only gates its POINTS ('pending' = penalty awaiting approval), not the score;
--   * an automatic analysis counts only when a manager approved it (manager_reviewed_at + _by).
--     The automatic writer stores impact_status='approved' with zero points; that is not an approval.
--   * operational_day = (conversation_date at time zone 'Africa/Cairo')::date. The previous RPC
--     used conversation_date::date, i.e. the UTC day, which moved conversations between 00:00 and
--     02:00/03:00 Cairo on the 26th into the previous cycle.
--
-- Rollback: restore the previous dawaa_monthly_evaluation_server_evidence_v5 body (production
-- definition md5 813fc34b0081cadd387933a226c84436, identical to this file except the review
-- block, the two extra counts and 'read_model'), then drop view
-- public.conversation_sales_reviews_monthly_official_v1. See
-- docs/WHATSAPP_MASTER_BRAIN_READINESS_20261026.md.

create or replace view public.conversation_sales_reviews_monthly_official_v1
with (security_invoker = true) as
select
  r.id,
  r.staff_id,
  r.doctor_id,
  r.branch,
  r.conversation_date,
  (r.conversation_date at time zone 'Africa/Cairo')::date as operational_day,
  r.final_score,
  r.total_score,
  r.impact_status,
  r.manager_reviewed_at,
  r.manager_reviewed_by,
  r.automatic_evaluation_version,
  r.evaluation_kind,
  case
    when r.automatic_evaluation_version is not null or lower(coalesce(r.evaluation_kind, '')) = 'automatic'
      then 'manager_approved_automatic'
    else 'human_reviewer'
  end as approval_basis
from public.conversation_sales_reviews_canonical_v2 r
where coalesce(r.is_current, true)
  and r.superseded_at is null
  and r.conversation_date is not null
  and lower(coalesce(r.impact_status, '')) not in ('reversed', 'rejected', 'cancelled')
  and (
    (r.automatic_evaluation_version is null and lower(coalesce(r.evaluation_kind, '')) <> 'automatic')
    or (r.manager_reviewed_at is not null and nullif(btrim(coalesce(r.manager_reviewed_by::text, '')), '') is not null)
  );

revoke all on public.conversation_sales_reviews_monthly_official_v1 from public, anon;
grant select on public.conversation_sales_reviews_monthly_official_v1 to authenticated, service_role;

create or replace function public.dawaa_monthly_evaluation_server_evidence_v5(p_staff_id uuid, p_evaluation_month date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_cycle_start date := (date_trunc('month',p_evaluation_month)::date - interval '1 month' + interval '25 days')::date;
  v_cycle_end_exclusive date := (date_trunc('month',p_evaluation_month)::date + interval '25 days')::date;
  v_reviews_available boolean := true;
  v_followups_available boolean := true;
  v_attendance_available boolean := true;
  v_review_count integer := 0;
  v_review_points_pending integer := 0;
  v_review_automatic_unapproved integer := 0;
  v_followup_count integer := 0;
  v_legacy_attendance_count integer := 0;
  v_modern_attendance_days integer := 0;
  v_errors jsonb := '{}'::jsonb;
begin
  begin
    select count(distinct r.id)::int
    into v_review_count
    from public.conversation_sales_reviews_monthly_official_v1 r
    where (r.staff_id=p_staff_id or r.doctor_id=p_staff_id)
      and r.operational_day >= v_cycle_start
      and r.operational_day < v_cycle_end_exclusive;

    -- Visible counts: official human reviews whose points await approval (scored, not payable) and
    -- automatic analyses no manager approved (never scored).
    select
      count(distinct r.id) filter (where r.automatic_evaluation_version is null and lower(coalesce(r.evaluation_kind,''))<>'automatic'
        and lower(coalesce(r.impact_status,'')) not in ('approved','reversed','rejected','cancelled'))::int,
      count(distinct r.id) filter (where (r.automatic_evaluation_version is not null or lower(coalesce(r.evaluation_kind,''))='automatic')
        and (r.manager_reviewed_at is null or nullif(btrim(coalesce(r.manager_reviewed_by::text,'')),'') is null))::int
    into v_review_points_pending, v_review_automatic_unapproved
    from public.conversation_sales_reviews_canonical_v2 r
    where (r.staff_id=p_staff_id or r.doctor_id=p_staff_id)
      and coalesce(r.is_current,true) and r.superseded_at is null
      and r.conversation_date is not null
      and (r.conversation_date at time zone 'Africa/Cairo')::date >= v_cycle_start
      and (r.conversation_date at time zone 'Africa/Cairo')::date < v_cycle_end_exclusive;
  exception when others then
    v_reviews_available := false;
    v_errors := v_errors || jsonb_build_object('reviews',sqlerrm);
  end;

  begin
    select count(distinct f.id)::int
    into v_followup_count
    from public.customer_followup_operations_v2 f
    where (
        f.staff_id=p_staff_id
        or f.assigned_staff_id=p_staff_id
        or nullif(trim(coalesce(f.requested_by_staff_id,'')),'')=p_staff_id::text
        or nullif(trim(coalesce(f.assigned_to_staff_id,'')),'')=p_staff_id::text
        or nullif(trim(coalesce(f.handled_by_staff_id,'')),'')=p_staff_id::text
      )
      and coalesce(f.is_hidden,false)=false
      and f.archived_at is null
      and (f.created_at at time zone 'Africa/Cairo')::date >= v_cycle_start
      and (f.created_at at time zone 'Africa/Cairo')::date < v_cycle_end_exclusive;
  exception when others then
    v_followups_available := false;
    v_errors := v_errors || jsonb_build_object('followups',sqlerrm);
  end;

  begin
    select count(*)::int
    into v_legacy_attendance_count
    from public.attendance a
    where nullif(trim(coalesce(a.staff_id,'')),'')=p_staff_id::text
      and coalesce(nullif(a.attendance_date::text,'')::date,nullif(a.date::text,'')::date) >= v_cycle_start
      and coalesce(nullif(a.attendance_date::text,'')::date,nullif(a.date::text,'')::date) < v_cycle_end_exclusive;

    select count(distinct l.shift_date::date)::int
    into v_modern_attendance_days
    from public.staff_attendance_logs l
    where l.staff_id=p_staff_id
      and l.status='accepted'
      and l.shift_date::date >= v_cycle_start
      and l.shift_date::date < v_cycle_end_exclusive;
  exception when others then
    v_attendance_available := false;
    v_errors := v_errors || jsonb_build_object('attendance',sqlerrm);
  end;

  return jsonb_build_object(
    'schema','monthly_evaluation_server_evidence_v5',
    'read_model','monthly_official_v1',
    'cycle_start',v_cycle_start,
    'cycle_end_exclusive',v_cycle_end_exclusive,
    'ready',v_reviews_available and v_followups_available and v_attendance_available,
    'health',jsonb_build_object(
      'reviews',case when v_reviews_available then 'available' else 'unavailable' end,
      'followups',case when v_followups_available then 'available' else 'unavailable' end,
      'attendance',case when v_attendance_available then 'available' else 'unavailable' end
    ),
    'counts',jsonb_build_object(
      'conversation_reviews',v_review_count,
      'conversation_reviews_points_pending_approval',v_review_points_pending,
      'conversation_reviews_automatic_unapproved',v_review_automatic_unapproved,
      'followups',v_followup_count,
      'legacy_attendance_rows',v_legacy_attendance_count,
      'modern_attendance_days',v_modern_attendance_days
    ),
    'errors',v_errors,
    'validated_at',now()
  );
end;
$function$;
revoke all on function public.dawaa_monthly_evaluation_server_evidence_v5(uuid,date) from public, anon, authenticated;
grant execute on function public.dawaa_monthly_evaluation_server_evidence_v5(uuid,date) to service_role;

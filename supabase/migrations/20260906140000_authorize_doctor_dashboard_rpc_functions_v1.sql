-- Critical class of findings while continuing the doctor-page review: several
-- SECURITY DEFINER RPC functions used by doctor-dashboard components took a
-- p_doctor_id/p_staff_id parameter and returned that person's data with NO check on
-- who was actually calling. Because these are SECURITY DEFINER, they bypass RLS
-- entirely -- fixing table-level RLS (see the two earlier migrations) does not
-- protect against a function like this. The app always called them with the logged-in
-- user's own id, so the UI never exposed this, but the RPC itself was directly
-- callable via the Supabase client with any other id.
--
-- Fixed by reusing the existing dawaa_can_read_employee_transaction(staff_id, branch)
-- guard (self / branch manager+CS roles same branch / top management):
--   - get_doctor_conversation_reviews_list  (review scores, reasons, training notes)
--   - get_doctor_today_review_count
--   - get_doctor_conversation_review_coverage (not currently called from the frontend)
--
-- Already verified as PROTECTED (no change needed) because they route through
-- dawaa_staff_points_truth_v2, which already calls the same guard and raises an
-- exception for an unauthorized caller:
--   - get_doctor_incentive_dashboard_v3, get_doctor_live_incentive_total,
--     get_doctor_pillar_breakdown, get_staff_points_dashboard_v3
--
-- APPLIED DIRECTLY TO PRODUCTION on 2026-09-06 via Supabase MCP. This file mirrors
-- that change into version control -- it does not need to be re-applied.

create or replace function public.get_doctor_conversation_reviews_list(p_doctor_id uuid, p_limit integer DEFAULT 30)
returns table(review_id uuid, review_date date, total_score numeric, reviewer_name text, top_deduction_reason text, training_recommendation text, points_value numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_branch text;
begin
  select s.branch into v_branch from public.staff s where s.id = p_doctor_id;
  if not public.dawaa_can_read_employee_transaction(p_doctor_id, v_branch) then
    raise exception 'not_authorized';
  end if;

  return query
  with reviews as (
    select
      r.id as review_id,
      coalesce(r.conversation_date::date, r.reviewed_at::date) as review_date,
      r.total_score, r.reviewer_name, r.top_deduction_reason, r.training_recommendation
    from public.conversation_sales_reviews r
    join public.staff s on s.id = p_doctor_id
    where public.dawaa_normalize_doctor_name(r.staff_name) = public.dawaa_normalize_doctor_name(s.name)
  ),
  points as (
    select
      (regexp_match(t.description, 'review_id:([0-9a-f-]{36})'))[1]::uuid as review_id,
      t.points_delta
    from public.employee_transactions t
    where t.staff_id = p_doctor_id and t.source = 'conversation_evaluation'
      and t.description ~ 'review_id:'
  )
  select r.review_id, r.review_date, r.total_score, r.reviewer_name,
    r.top_deduction_reason, r.training_recommendation, p.points_delta
  from reviews r
  left join points p on p.review_id = r.review_id
  order by r.review_date desc
  limit p_limit;
end;
$function$;

create or replace function public.get_doctor_today_review_count(p_doctor_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_branch text;
begin
  select s.branch into v_branch from public.staff s where s.id = p_doctor_id;
  if not public.dawaa_can_read_employee_transaction(p_doctor_id, v_branch) then
    raise exception 'not_authorized';
  end if;

  return (
    select count(*)::integer
    from public.conversation_sales_reviews r
    join public.staff s on s.id = p_doctor_id
    where public.dawaa_normalize_doctor_name(r.staff_name) = public.dawaa_normalize_doctor_name(s.name)
      and coalesce(r.conversation_date::date, r.reviewed_at::date) = current_date
  );
end;
$function$;

create or replace function public.get_doctor_conversation_review_coverage(p_doctor_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_branch text;
begin
  select s.branch into v_branch from public.staff s where s.id = p_doctor_id;
  if not public.dawaa_can_read_employee_transaction(p_doctor_id, v_branch) then
    raise exception 'not_authorized';
  end if;

  return (
    select count(*)::integer
    from public.conversation_sales_reviews r
    join public.staff s on s.id = p_doctor_id
    where public.dawaa_normalize_doctor_name(r.staff_name) = public.dawaa_normalize_doctor_name(s.name)
      and coalesce(r.conversation_date::date, r.reviewed_at::date) >= date_trunc('month', current_date)::date
  );
end;
$function$;

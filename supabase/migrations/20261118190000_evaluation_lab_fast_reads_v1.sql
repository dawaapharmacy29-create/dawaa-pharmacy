-- /evaluation-lab speed and completeness (owner request 2026-11-18).
--
-- Measured on 2026-11-18: the page took ~4 minutes. It read the cycle's invoices one Cairo day per
-- request (two cycles, ~110 requests of 1–18 s each on a busy database), and the conversation
-- reviews through the security_invoker view conversation_sales_reviews_canonical_v2, whose
-- row-by-row policies hit the 8 s anon statement timeout (HTTP 500). That one failure failed the
-- whole load and the page started over, so every source was read twice.
--
-- 1. get_evaluation_lab_invoices_v1: the invoices of a date range in one call, as compact rows,
--    behind the same scope as the sales_invoices SELECT policy (all branches, one branch, or none).
-- 2. get_evaluation_lab_reviews_v1: the cycle's canonical conversation reviews in one call, for an
--    actor who may read every review (view_reviews + read mode "all", as the RLS policy allows).
-- 3. The app calls with the anon role and a staff session (see 20261118160000): the two review-
--    sample RPCs were granted to authenticated only, so the lab got 401 and showed the weekly
--    review axes as "not readable from this session". Their own guard (manage_evaluation_rules)
--    stays the check.

create or replace function public.get_evaluation_lab_invoices_v1(p_start date, p_end_exclusive date)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
declare
  v_scope text := public.dawaa_current_sales_invoice_scope_v1(array['view_dashboard', 'view_sales', 'view_invoice_import',
    'view_all_invoices', 'import_sales_invoices', 'view_quarterly_incentives', 'view_points']);
  v_from timestamptz;
  v_to timestamptz;
begin
  if public.dawaa_current_staff_account_id_strict() is null or coalesce(v_scope, 'NONE') = 'NONE' then
    raise exception 'evaluation_lab_invoices_not_authorized' using errcode = '42501';
  end if;
  if p_start is null or p_end_exclusive is null or p_end_exclusive <= p_start or p_end_exclusive - p_start > 62 then
    raise exception 'evaluation_lab_invoices_invalid_range' using errcode = '22023';
  end if;
  -- Cairo wall-clock day boundaries, as the app's cairoDateBoundaryIso.
  v_from := p_start::timestamp at time zone 'Africa/Cairo';
  v_to := p_end_exclusive::timestamp at time zone 'Africa/Cairo';
  -- Column order is the client's contract (EVALUATION_LAB_INVOICE_COLUMNS).
  return coalesce((
    select jsonb_agg(jsonb_build_array(i.id, i.staff_id, i.net_amount, i.total_amount, i.customer_code, i.branch,
                                       i.delivery_staff, i.sale_date, i.invoice_datetime, i.line_items_count, i.discount_amount)
                     order by i.invoice_date, i.id)
    from public.sales_invoices i
    where i.invoice_date >= v_from and i.invoice_date < v_to
      and (v_scope = 'ALL' or i.branch = v_scope)
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.get_evaluation_lab_invoices_v1(date, date) from public;
grant execute on function public.get_evaluation_lab_invoices_v1(date, date) to anon, authenticated, service_role;

create or replace function public.get_evaluation_lab_reviews_v1(p_start date, p_end_exclusive date)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_catalog'
as $function$
begin
  if public.dawaa_current_staff_account_id_strict() is null
     or not coalesce(public.dawaa_current_actor_can(array['view_reviews']), false)
     or coalesce((select s.read_mode from public.dawaa_conversation_review_read_scope_v1() s(read_mode, actor_id, actor_staff_id, branch_key) limit 1), '') <> 'all' then
    raise exception 'evaluation_lab_reviews_not_authorized' using errcode = '42501';
  end if;
  if p_start is null or p_end_exclusive is null or p_end_exclusive <= p_start or p_end_exclusive - p_start > 62 then
    raise exception 'evaluation_lab_reviews_invalid_range' using errcode = '22023';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'staff_id', r.staff_id, 'doctor_id', r.doctor_id, 'is_current', r.is_current,
      'superseded_at', r.superseded_at, 'impact_status', r.impact_status, 'evaluation_kind', r.evaluation_kind,
      'automatic_evaluation_version', r.automatic_evaluation_version, 'manager_reviewed_at', r.manager_reviewed_at,
      'manager_reviewed_by', r.manager_reviewed_by, 'conversation_date', r.conversation_date,
      'final_score', r.final_score, 'total_score', r.total_score) order by r.id)
    from public.conversation_sales_reviews_canonical_v2 r
    where r.conversation_date >= (p_start::timestamp at time zone 'Africa/Cairo')
      and r.conversation_date < (p_end_exclusive::timestamp at time zone 'Africa/Cairo')
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.get_evaluation_lab_reviews_v1(date, date) from public;
grant execute on function public.get_evaluation_lab_reviews_v1(date, date) to anon, authenticated, service_role;

grant execute on function public.get_evaluation_review_scores_v1(date) to anon;
grant execute on function public.list_evaluation_branch_cycle_targets_v1() to anon;

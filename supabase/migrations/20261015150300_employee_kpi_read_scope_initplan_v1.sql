-- employee_kpi_30d_summary: resolve the KPI actor scope once per statement.
--
-- Production smoke (2026-10-15): /employee-kpi returned 500 (~30 s). Besides the per-row RLS on
-- employee_transactions and conversation_sales_reviews (fixed by 20261015140000), the view filters staff with
-- dawaa_can_read_staff_kpi(s.id, s.branch), which resolves the session actor and permissions for every staff
-- row — the same per-row pattern that costs attendance_dashboard_daily_summary_v1 6–14.5 s for ~75 staff.
--
-- public.dawaa_staff_kpi_read_scope_v1() returns the actor part of dawaa_can_read_staff_kpi once:
--   'none'   no verified actor, no active+can_login account, or no view_team permission
--   'all'    general_manager / executive_manager / branches_manager
--   'branch' branch_manager / customer_service_manager / shift supervisors with a non-empty (trimmed) branch
-- and the view keeps the row rule: staff id present, and for 'branch' a non-empty trimmed staff branch equal
-- to the actor branch. dawaa_can_read_staff_kpi itself is unchanged. The view definition is otherwise the exact
-- Production definition (2026-10-15); security_invoker=true is restated because CREATE OR REPLACE VIEW
-- replaces view options. Columns, owner and grants are unchanged.

create or replace function public.dawaa_staff_kpi_read_scope_v1()
returns table(read_mode text, branch_scope text)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account_id uuid;
  v_role text;
  v_branch text;
  v_permissions jsonb;
begin
  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then
    return query select 'none'::text, null::text;
    return;
  end if;

  select
    lower(trim(coalesce(sa.role, ''))),
    trim(coalesce(sa.branch, '')),
    public.get_user_permissions(sa.id)
  into v_role, v_branch, v_permissions
  from public.staff_accounts sa
  where sa.id = v_account_id
    and coalesce(sa.active, false) = true
    and coalesce(sa.can_login, false) = true
  limit 1;

  if not found
     or not public.dawaa_jsonb_has_true_any(coalesce(v_permissions, '{}'::jsonb), array['view_team']) then
    return query select 'none'::text, null::text;
    return;
  end if;

  if v_role in ('general_manager','executive_manager','branches_manager') then
    return query select 'all'::text, null::text;
  elsif v_role in ('branch_manager','customer_service_manager','shift_supervisor_morning','shift_supervisor_evening')
        and nullif(v_branch, '') is not null then
    return query select 'branch'::text, v_branch;
  else
    return query select 'none'::text, null::text;
  end if;
end;
$function$;

revoke all on function public.dawaa_staff_kpi_read_scope_v1() from public;
grant execute on function public.dawaa_staff_kpi_read_scope_v1() to anon, authenticated, service_role;

create or replace view public.employee_kpi_30d_summary
with (security_invoker = true)
as
 WITH bounds AS (
         SELECT (CURRENT_DATE - '30 days'::interval)::date AS start_date
        ), transactions_agg AS (
         SELECT et.staff_id,
            true AS has_points_data,
            COALESCE(sum(
                CASE
                    WHEN et.points_delta > 0::numeric THEN et.points_delta
                    ELSE 0::numeric
                END), 0::numeric) AS reward_points,
            COALESCE(sum(
                CASE
                    WHEN et.points_delta < 0::numeric THEN abs(et.points_delta)
                    ELSE 0::numeric
                END), 0::numeric) AS penalty_points
           FROM employee_transactions et
             CROSS JOIN bounds b
          WHERE et.staff_id IS NOT NULL AND (et.status = ANY (ARRAY['active'::text, 'approved'::text])) AND et.transaction_date >= b.start_date
          GROUP BY et.staff_id
        ), reviews_agg AS (
         SELECT r.staff_id,
            true AS has_review_data,
            round(avg(COALESCE(r.final_score, r.total_score)), 1) AS avg_review_score,
            count(*) FILTER (WHERE COALESCE(r.final_score, r.total_score) IS NOT NULL)::integer AS review_count
           FROM conversation_sales_reviews_official_v1 r
             CROSS JOIN bounds b
          WHERE r.staff_id IS NOT NULL AND r.created_at >= b.start_date
          GROUP BY r.staff_id
        )
 SELECT s.id AS staff_id,
    s.name AS staff_name,
    COALESCE(s.branch, 'غير محدد'::text) AS branch,
    COALESCE(s.role, 'موظف'::text) AS role,
    COALESCE(tx.reward_points, 0::numeric) AS reward_points,
    COALESCE(tx.penalty_points, 0::numeric) AS penalty_points,
    COALESCE(tx.has_points_data, false) AS has_points_data,
    COALESCE(rv.avg_review_score, 0::numeric) AS avg_review_score,
    COALESCE(rv.review_count, 0) AS review_count,
    COALESCE(rv.has_review_data, false) AS has_review_data
   FROM staff s
     LEFT JOIN transactions_agg tx ON tx.staff_id = s.id
     LEFT JOIN reviews_agg rv ON rv.staff_id = s.id
  WHERE s.active = true
    AND s.id IS NOT NULL
    AND (
      (SELECT kpi_scope.read_mode FROM public.dawaa_staff_kpi_read_scope_v1() kpi_scope) = 'all'
      OR (
        (SELECT kpi_scope.read_mode FROM public.dawaa_staff_kpi_read_scope_v1() kpi_scope) = 'branch'
        AND NULLIF(TRIM(COALESCE(s.branch, '')), '') IS NOT NULL
        AND TRIM(s.branch) = (SELECT kpi_scope.branch_scope FROM public.dawaa_staff_kpi_read_scope_v1() kpi_scope)
      )
    )
  ORDER BY s.name;

notify pgrst, 'reload schema';

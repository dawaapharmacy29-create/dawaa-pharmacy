-- Fixture for 20261015150300_employee_kpi_read_scope_initplan_v1.
-- Base actors, verified-session stand-in, helpers and employee_transactions (with its pre-M1 policy):
\ir rls_actor_scope_initplan_v1.fixture.sql

update public.account_permissions
   set permissions = permissions || '{"view_team": true}'::jsonb
 where account_id in (
   'a0000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000004',
   'a0000000-0000-4000-8000-000000000005', 'a0000000-0000-4000-8000-000000000006', 'a0000000-0000-4000-8000-000000000007',
   'a0000000-0000-4000-8000-000000000009', 'a0000000-0000-4000-8000-000000000010', 'a0000000-0000-4000-8000-000000000012');
update public.account_permissions set permissions = permissions || '{"view_points": true}'::jsonb
 where account_id = 'a0000000-0000-4000-8000-000000000005';
insert into public.staff_accounts (id, staff_id, role, branch, active, can_login) values
  ('e0000000-0000-4000-8000-000000000001', null, 'shift_supervisor_evening', ' فرع الشامي ', true, true),
  ('e0000000-0000-4000-8000-000000000002', null, 'customer_service_manager', '   ', true, true);
insert into public.account_permissions (account_id, permissions) values
  ('e0000000-0000-4000-8000-000000000001', '{"view_team": true, "view_points": true}'),
  ('e0000000-0000-4000-8000-000000000002', '{"view_team": true}');

create table public.staff (id uuid primary key, name text, branch text, role text, active boolean);
grant select on public.staff to anon, authenticated;

alter table public.employee_transactions add column points_delta numeric, add column status text, add column transaction_date date;
update public.employee_transactions set points_delta = (id * 5 - 20), status = 'active', transaction_date = current_date - 3;

create table public.conversation_sales_reviews_official_v1 (staff_id uuid, final_score numeric, total_score numeric, created_at timestamptz);
grant select on public.conversation_sales_reviews_official_v1 to anon, authenticated;

insert into public.staff (id, name, branch, role, active) values
  ('50000000-0000-4000-8000-000000000002', 'أ', 'فرع شكري', 'pharmacist', true),
  ('50000000-0000-4000-8000-000000000004', 'ب', ' فرع شكري', 'branch_manager', true),
  ('50000000-0000-4000-8000-000000000005', 'ج', 'فرع الشامي', 'branch_manager', true),
  ('50000000-0000-4000-8000-000000000006', 'د', '', 'customer_service', true),
  ('50000000-0000-4000-8000-000000000007', 'ه', null, 'shift_supervisor_morning', true),
  ('50000000-0000-4000-8000-000000000008', 'و', 'فرع الشامي ', 'delivery', true),
  ('50000000-0000-4000-8000-000000000009', 'ز', 'فرع شكري', 'pharmacist', false);
insert into public.conversation_sales_reviews_official_v1 values
  ('50000000-0000-4000-8000-000000000002', 8, 7, now() - interval '2 days'),
  ('50000000-0000-4000-8000-000000000005', null, 6, now() - interval '1 day'),
  ('50000000-0000-4000-8000-000000000008', 9, null, now() - interval '40 days');

-- Production definition (2026-10-15) of the per-row helper.
create or replace function public.dawaa_can_read_staff_kpi(p_staff_id uuid, p_branch text)
returns boolean
language plpgsql
stable security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_account_id uuid;
  v_role text;
  v_branch text;
  v_permissions jsonb;
begin
  if p_staff_id is null then
    return false;
  end if;

  v_account_id := public.dawaa_current_staff_account_id_strict();
  if v_account_id is null then
    return false;
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

  if not found then
    return false;
  end if;

  if not public.dawaa_jsonb_has_true_any(
    coalesce(v_permissions, '{}'::jsonb),
    array['view_team']
  ) then
    return false;
  end if;

  if v_role in (
    'general_manager',
    'executive_manager',
    'branches_manager'
  ) then
    return true;
  end if;

  if v_role in (
    'branch_manager',
    'customer_service_manager',
    'shift_supervisor_morning',
    'shift_supervisor_evening'
  ) then
    return nullif(v_branch, '') is not null
      and nullif(trim(coalesce(p_branch, '')), '') is not null
      and trim(p_branch) = v_branch;
  end if;

  return false;
end;
$function$;
grant execute on function public.dawaa_can_read_staff_kpi(uuid, text) to anon, authenticated;

-- Production view definition (2026-10-15) before the migration: the current object and the oracle copy.
create view public.employee_kpi_30d_summary with (security_invoker = true) as
 WITH bounds AS (SELECT (CURRENT_DATE - '30 days'::interval)::date AS start_date),
 transactions_agg AS (
   SELECT et.staff_id, true AS has_points_data,
     COALESCE(sum(CASE WHEN et.points_delta > 0::numeric THEN et.points_delta ELSE 0::numeric END), 0::numeric) AS reward_points,
     COALESCE(sum(CASE WHEN et.points_delta < 0::numeric THEN abs(et.points_delta) ELSE 0::numeric END), 0::numeric) AS penalty_points
   FROM employee_transactions et CROSS JOIN bounds b
   WHERE et.staff_id IS NOT NULL AND (et.status = ANY (ARRAY['active'::text, 'approved'::text])) AND et.transaction_date >= b.start_date
   GROUP BY et.staff_id),
 reviews_agg AS (
   SELECT r.staff_id, true AS has_review_data,
     round(avg(COALESCE(r.final_score, r.total_score)), 1) AS avg_review_score,
     count(*) FILTER (WHERE COALESCE(r.final_score, r.total_score) IS NOT NULL)::integer AS review_count
   FROM conversation_sales_reviews_official_v1 r CROSS JOIN bounds b
   WHERE r.staff_id IS NOT NULL AND r.created_at >= b.start_date
   GROUP BY r.staff_id)
 SELECT s.id AS staff_id, s.name AS staff_name, COALESCE(s.branch, 'غير محدد'::text) AS branch, COALESCE(s.role, 'موظف'::text) AS role,
   COALESCE(tx.reward_points, 0::numeric) AS reward_points, COALESCE(tx.penalty_points, 0::numeric) AS penalty_points,
   COALESCE(tx.has_points_data, false) AS has_points_data, COALESCE(rv.avg_review_score, 0::numeric) AS avg_review_score,
   COALESCE(rv.review_count, 0) AS review_count, COALESCE(rv.has_review_data, false) AS has_review_data
 FROM staff s LEFT JOIN transactions_agg tx ON tx.staff_id = s.id LEFT JOIN reviews_agg rv ON rv.staff_id = s.id
 WHERE s.active = true AND dawaa_can_read_staff_kpi(s.id, s.branch)
 ORDER BY s.name;

create view public.test_old_employee_kpi_30d_summary with (security_invoker = true) as
  select * from public.employee_kpi_30d_summary;
-- The oracle must keep the old definition after the migration replaces the real view, so it is re-created as an
-- independent copy below (a view over the replaced view would follow the new definition).
drop view public.test_old_employee_kpi_30d_summary;
create view public.test_old_employee_kpi_30d_summary with (security_invoker = true) as
 WITH bounds AS (SELECT (CURRENT_DATE - '30 days'::interval)::date AS start_date),
 transactions_agg AS (
   SELECT et.staff_id, true AS has_points_data,
     COALESCE(sum(CASE WHEN et.points_delta > 0::numeric THEN et.points_delta ELSE 0::numeric END), 0::numeric) AS reward_points,
     COALESCE(sum(CASE WHEN et.points_delta < 0::numeric THEN abs(et.points_delta) ELSE 0::numeric END), 0::numeric) AS penalty_points
   FROM employee_transactions et CROSS JOIN bounds b
   WHERE et.staff_id IS NOT NULL AND (et.status = ANY (ARRAY['active'::text, 'approved'::text])) AND et.transaction_date >= b.start_date
   GROUP BY et.staff_id),
 reviews_agg AS (
   SELECT r.staff_id, true AS has_review_data,
     round(avg(COALESCE(r.final_score, r.total_score)), 1) AS avg_review_score,
     count(*) FILTER (WHERE COALESCE(r.final_score, r.total_score) IS NOT NULL)::integer AS review_count
   FROM conversation_sales_reviews_official_v1 r CROSS JOIN bounds b
   WHERE r.staff_id IS NOT NULL AND r.created_at >= b.start_date
   GROUP BY r.staff_id)
 SELECT s.id AS staff_id, s.name AS staff_name, COALESCE(s.branch, 'غير محدد'::text) AS branch, COALESCE(s.role, 'موظف'::text) AS role,
   COALESCE(tx.reward_points, 0::numeric) AS reward_points, COALESCE(tx.penalty_points, 0::numeric) AS penalty_points,
   COALESCE(tx.has_points_data, false) AS has_points_data, COALESCE(rv.avg_review_score, 0::numeric) AS avg_review_score,
   COALESCE(rv.review_count, 0) AS review_count, COALESCE(rv.has_review_data, false) AS has_review_data
 FROM staff s LEFT JOIN transactions_agg tx ON tx.staff_id = s.id LEFT JOIN reviews_agg rv ON rv.staff_id = s.id
 WHERE s.active = true AND dawaa_can_read_staff_kpi(s.id, s.branch)
 ORDER BY s.name;
grant select on public.employee_kpi_30d_summary, public.test_old_employee_kpi_30d_summary to anon, authenticated;

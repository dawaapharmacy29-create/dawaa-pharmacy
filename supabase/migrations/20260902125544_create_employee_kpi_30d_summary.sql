create or replace function public.dawaa_can_read_staff_kpi(
  p_staff_id uuid,
  p_branch text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
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
$$;

revoke all on function public.dawaa_can_read_staff_kpi(uuid, text) from public;
grant execute on function public.dawaa_can_read_staff_kpi(uuid, text) to authenticated, service_role;

create or replace view public.employee_kpi_30d_summary
with (security_invoker = true)
as
with bounds as (
  select (current_date - interval '30 days')::date as start_date
),
transactions_agg as (
  select
    et.staff_id,
    true as has_points_data,
    coalesce(sum(case when et.points_delta > 0 then et.points_delta else 0 end), 0)::numeric as reward_points,
    coalesce(sum(case when et.points_delta < 0 then abs(et.points_delta) else 0 end), 0)::numeric as penalty_points
  from public.employee_transactions et
  cross join bounds b
  where et.staff_id is not null
    and et.status in ('active', 'approved')
    and et.transaction_date >= b.start_date
  group by et.staff_id
),
reviews_agg as (
  select
    r.staff_id,
    true as has_review_data,
    round(avg(coalesce(r.final_score, r.total_score))::numeric, 1) as avg_review_score,
    count(*) filter (where coalesce(r.final_score, r.total_score) is not null)::integer as review_count
  from public.conversation_sales_reviews r
  cross join bounds b
  where r.staff_id is not null
    and r.created_at >= b.start_date
  group by r.staff_id
)
select
  s.id as staff_id,
  s.name as staff_name,
  coalesce(s.branch, 'غير محدد') as branch,
  coalesce(s.role, 'موظف') as role,
  coalesce(tx.reward_points, 0) as reward_points,
  coalesce(tx.penalty_points, 0) as penalty_points,
  coalesce(tx.has_points_data, false) as has_points_data,
  coalesce(rv.avg_review_score, 0) as avg_review_score,
  coalesce(rv.review_count, 0) as review_count,
  coalesce(rv.has_review_data, false) as has_review_data
from public.staff s
left join transactions_agg tx on tx.staff_id = s.id
left join reviews_agg rv on rv.staff_id = s.id
where s.active = true
  and public.dawaa_can_read_staff_kpi(s.id, s.branch)
order by s.name asc;

revoke all on public.employee_kpi_30d_summary from public;
grant select on public.employee_kpi_30d_summary to authenticated, service_role;

comment on view public.employee_kpi_30d_summary is
  'Operational 30-day raw KPI aggregation for authorized team, points, and review readers. Attendance and tasks are deferred until canonical read policies/projections exist.';

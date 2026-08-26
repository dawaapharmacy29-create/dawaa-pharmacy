-- Points Architecture V3 - fast team/manager summary.
-- Replaces client-side 5000-row ledger scans for top-level team cards.

create or replace function public.get_staff_points_manager_summary_v3(
  p_month_cycle text default null,
  p_branch text default null
)
returns table(
  staff_id uuid,
  staff_name text,
  staff_role text,
  branch text,
  month_cycle text,
  starting_points numeric,
  reward_points numeric,
  deduction_points numeric,
  final_points numeric,
  progress_pct numeric,
  points_incentive_egp numeric,
  max_incentive_egp numeric,
  pending_reward_points numeric,
  pending_deduction_points numeric,
  profile_configured boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text := lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_actor_branch text := nullif(trim(coalesce(public.employee_operating_actor_branch(),'')), '');
  v_branch text := nullif(trim(coalesce(p_branch,'')), '');
  v_cycle text := coalesce(nullif(trim(coalesce(p_month_cycle,'')),''), public.dawaa_current_points_cycle_label_v1());
  v_global boolean := v_role in ('general_manager','admin','executive_manager','branches_manager');
begin
  if not (v_global or v_role in ('branch_manager','customer_service_manager')) then
    raise exception 'not_authorized';
  end if;

  if not v_global then
    if v_actor_branch is null then raise exception 'manager_branch_missing'; end if;
    if v_branch is not null and v_branch is distinct from v_actor_branch then
      raise exception 'not_authorized_for_branch';
    end if;
    v_branch := v_actor_branch;
  end if;

  return query
  select
    t.staff_id,
    t.staff_name,
    t.staff_role,
    t.branch,
    t.month_cycle,
    t.starting_points,
    t.reward_points,
    t.deduction_points,
    t.final_points,
    t.progress_pct,
    case when t.profile_configured then t.points_incentive_egp else null end,
    case when t.profile_configured then t.max_incentive_egp else null end,
    t.pending_reward_points,
    t.pending_deduction_points,
    t.profile_configured
  from public.staff s
  cross join lateral public.dawaa_staff_points_truth_v2(s.id, v_cycle) t
  where coalesce(s.active, s.is_active, true)
    and coalesce(s.status,'active') not in ('inactive','deleted','disabled')
    and (v_branch is null or s.branch = v_branch)
  order by t.branch, t.staff_name;
end;
$$;

revoke all on function public.get_staff_points_manager_summary_v3(text,text) from public;
grant execute on function public.get_staff_points_manager_summary_v3(text,text) to anon, authenticated;

comment on function public.get_staff_points_manager_summary_v3(text,text) is
  'Manager/team read model using canonical points truth in one server-side call. Financial columns are null without a configured compensation profile.';

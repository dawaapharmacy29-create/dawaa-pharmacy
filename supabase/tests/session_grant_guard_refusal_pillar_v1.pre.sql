-- Guard refusal case for 20261015140200: the points truth behind get_doctor_pillar_breakdown loses its
-- authorization check. The migration must refuse the anon grant.
create or replace function public.dawaa_staff_points_truth_v2(p_staff_id uuid, p_month_cycle text default null)
returns table(staff_id uuid, staff_name text, staff_role text, branch text, tier_key text, month_cycle text, starting_points numeric, reward_points numeric, deduction_points numeric, net_points_delta numeric, final_points numeric, distinction_points numeric, target_points integer, point_rate_egp numeric, max_incentive_egp numeric, points_incentive_egp numeric, competition_bonus_egp numeric, final_incentive_egp numeric, progress_pct numeric, pending_reward_points numeric, pending_deduction_points numeric, profile_configured boolean)
language plpgsql stable security definer set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_staff public.staff%rowtype;
begin
  select * into v_staff from public.staff s where s.id = p_staff_id;
  if not found then
    return;
  end if;

  return query select p_staff_id, v_staff.name, v_staff.role, v_staff.branch, null::text,
    coalesce(p_month_cycle, '2026-10'), 0::numeric, 10::numeric, 2::numeric, 8::numeric, 8::numeric, 0::numeric, 500,
    3::numeric, 1500::numeric, 24::numeric, 0::numeric, 24::numeric, 1.6::numeric, 0::numeric, 0::numeric, true;
end;
$function$;

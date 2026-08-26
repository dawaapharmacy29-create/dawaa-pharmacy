-- Points Architecture V3 - financial safety.
-- The legacy doctor composer still has fallback financial values; V3 must never expose them
-- when the employee has no configured compensation profile.

create or replace function public.get_doctor_incentive_dashboard_v3(p_doctor_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_total jsonb;
  v_truth jsonb;
  v_pillars jsonb := '[]'::jsonb;
  v_profile_configured boolean;
  v_total_expected numeric;
  v_points_incentive numeric;
  v_point_rate numeric;
  v_max_incentive numeric;
begin
  v_truth := public.get_staff_points_dashboard_v3(p_doctor_id, null);
  if coalesce(v_truth->>'error','') <> '' then return v_truth; end if;

  v_total := public.get_doctor_live_incentive_total(p_doctor_id);
  if coalesce(v_total->>'error','') <> '' then return v_total; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'pillar_key', p.pillar_key,
    'points', p.points,
    'has_competition_win', p.has_competition_win
  ) order by p.pillar_key), '[]'::jsonb)
  into v_pillars
  from public.get_doctor_pillar_breakdown(p_doctor_id, null) p;

  v_profile_configured := coalesce((v_truth->>'profile_configured')::boolean, false);
  if v_profile_configured then
    v_points_incentive := (v_truth->>'points_incentive_egp')::numeric;
    v_point_rate := (v_truth->>'point_rate_egp')::numeric;
    v_max_incentive := (v_truth->>'max_incentive_egp')::numeric;
    v_total_expected := coalesce((v_total->>'total_expected_egp')::numeric,0)
      + coalesce((v_truth->>'competition_bonus_egp')::numeric,0);
  else
    v_points_incentive := null;
    v_point_rate := null;
    v_max_incentive := null;
    v_total_expected := null;
  end if;

  return v_truth || v_total || jsonb_build_object(
    'engine_version', 3,
    'pillars', v_pillars,
    'profile_configured', v_profile_configured,
    'point_rate_egp', v_point_rate,
    'max_incentive_egp', v_max_incentive,
    'base_incentive_egp', v_points_incentive,
    'points_incentive_egp', v_points_incentive,
    'total_expected_egp', v_total_expected
  );
end;
$$;

revoke all on function public.get_doctor_incentive_dashboard_v3(uuid) from public;
grant execute on function public.get_doctor_incentive_dashboard_v3(uuid) to anon, authenticated;

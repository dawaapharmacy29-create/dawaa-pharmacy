-- Points Architecture V3 - keep the displayed doctor total equal to every visible monetary component.

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
  v_total_expected numeric;
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

  if coalesce((v_truth->>'profile_configured')::boolean, false) then
    v_total_expected := coalesce((v_total->>'total_expected_egp')::numeric,0)
      + coalesce((v_truth->>'competition_bonus_egp')::numeric,0);
  else
    v_total_expected := null;
  end if;

  return v_truth || v_total || jsonb_build_object(
    'engine_version', 3,
    'pillars', v_pillars,
    'profile_configured', coalesce((v_truth->>'profile_configured')::boolean, false),
    'total_expected_egp', v_total_expected
  );
end;
$$;

revoke all on function public.get_doctor_incentive_dashboard_v3(uuid) from public;
grant execute on function public.get_doctor_incentive_dashboard_v3(uuid) to anon, authenticated;

-- Points Architecture V3 - fast read models and architecture health.
-- Keeps financial target bonuses separate while exposing one fast dashboard payload.

create or replace function public.get_staff_points_dashboard_v3(
  p_staff_id uuid,
  p_month_cycle text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_truth record;
  v_sources jsonb := '[]'::jsonb;
  v_cleaning jsonb := null;
begin
  select * into v_truth
  from public.dawaa_staff_points_truth_v2(p_staff_id, p_month_cycle)
  limit 1;

  if not found then
    return jsonb_build_object('error','staff_not_found_or_not_authorized');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'source', x.source,
    'points', x.points,
    'events', x.events
  ) order by abs(x.points) desc, x.source), '[]'::jsonb)
  into v_sources
  from (
    select
      coalesce(nullif(l.source,''),'unknown') as source,
      round(sum(l.signed_points),2) as points,
      count(*)::int as events
    from public.dawaa_employee_points_ledger_v2 l
    where l.staff_id = p_staff_id
      and l.month_cycle = v_truth.month_cycle
    group by coalesce(nullif(l.source,''),'unknown')
  ) x;

  if public.dawaa_is_cleaning_role_v1(v_truth.staff_role) then
    select to_jsonb(s) into v_cleaning
    from public.get_cleaning_cycle_rating_summary_v1(p_staff_id, v_truth.month_cycle) s
    limit 1;
  end if;

  return jsonb_build_object(
    'engine_version', 3,
    'staff_id', v_truth.staff_id,
    'staff_name', v_truth.staff_name,
    'staff_role', v_truth.staff_role,
    'branch', v_truth.branch,
    'tier_key', v_truth.tier_key,
    'month_cycle', v_truth.month_cycle,
    'starting_points', v_truth.starting_points,
    'reward_points', v_truth.reward_points,
    'deduction_points', v_truth.deduction_points,
    'net_points_delta', v_truth.net_points_delta,
    'final_points', v_truth.final_points,
    'distinction_points', v_truth.distinction_points,
    'target_points', v_truth.target_points,
    'point_rate_egp', case when v_truth.profile_configured then v_truth.point_rate_egp else null end,
    'max_incentive_egp', case when v_truth.profile_configured then v_truth.max_incentive_egp else null end,
    'points_incentive_egp', case when v_truth.profile_configured then v_truth.points_incentive_egp else null end,
    'competition_bonus_egp', v_truth.competition_bonus_egp,
    'final_incentive_egp', case when v_truth.profile_configured then v_truth.final_incentive_egp else null end,
    'progress_pct', v_truth.progress_pct,
    'pending_reward_points', v_truth.pending_reward_points,
    'pending_deduction_points', v_truth.pending_deduction_points,
    'profile_configured', v_truth.profile_configured,
    'source_breakdown', v_sources,
    'cleaning_rating', v_cleaning
  );
end;
$$;

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

  return v_truth || v_total || jsonb_build_object(
    'engine_version', 3,
    'pillars', v_pillars,
    'profile_configured', coalesce((v_truth->>'profile_configured')::boolean, false),
    'total_expected_egp', case
      when coalesce((v_truth->>'profile_configured')::boolean, false)
        then (v_total->>'total_expected_egp')::numeric
      else null
    end
  );
end;
$$;

create or replace function public.get_points_architecture_health_v3()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $$
declare
  v_role text := lower(trim(coalesce(public.employee_operating_actor_role(),'')));
  v_global boolean := v_role in ('general_manager','admin','executive_manager','branches_manager');
  v_branch text := nullif(trim(coalesce(public.employee_operating_actor_branch(),'')), '');
  v_result jsonb;
begin
  if not (v_global or v_role = 'branch_manager') then
    raise exception 'not_authorized';
  end if;

  with active_staff as (
    select s.*
    from public.staff s
    where coalesce(s.active, s.is_active, true)
      and coalesce(s.status,'active') not in ('inactive','deleted','disabled')
      and (v_global or coalesce(s.branch,'') = coalesce(v_branch,''))
  ), missing_profiles as (
    select s.id
    from active_staff s
    left join public.employee_compensation_profiles p
      on p.staff_id = s.id::text and coalesce(p.active,true)
    where p.staff_id is null
  ), duplicate_events as (
    select et.staff_id, et.month_cycle, et.source, et.source_id
    from public.employee_transactions et
    join active_staff s on s.id = et.staff_id
    where et.source_id is not null
      and et.status in ('active','approved','pending')
    group by et.staff_id, et.month_cycle, et.source, et.source_id
    having count(*) > 1
  ), malformed_transactions as (
    select
      count(*) filter (where et.month_cycle is null or trim(et.month_cycle)='')::int as missing_cycle,
      count(*) filter (where et.source is null or trim(et.source)='')::int as missing_source,
      count(*) filter (where et.points_delta is null and et.final_points is null and et.points is null)::int as missing_points
    from public.employee_transactions et
    join active_staff s on s.id = et.staff_id
    where et.status in ('active','approved','pending')
  )
  select jsonb_build_object(
    'engine_version', 3,
    'scope_branch', case when v_global then 'كل الفروع' else v_branch end,
    'active_staff', (select count(*) from active_staff),
    'missing_compensation_profiles', (select count(*) from missing_profiles),
    'active_legacy_rules', (
      select count(*)
      from public.evaluation_rules er
      where coalesce(er.active, er.is_active, true)
        and coalesce(nullif(trim(er.rule_code),''), nullif(trim(er.rule_key),''), '') like 'legacy_rule_%'
    ),
    'duplicate_active_event_groups', (select count(*) from duplicate_events),
    'transactions_missing_cycle', (select missing_cycle from malformed_transactions),
    'transactions_missing_source', (select missing_source from malformed_transactions),
    'transactions_missing_points', (select missing_points from malformed_transactions),
    'generated_at', now(),
    'status', case
      when (select count(*) from duplicate_events) > 0 then 'critical'
      when (select count(*) from missing_profiles) > 0
        or (select count(*) from public.evaluation_rules er where coalesce(er.active, er.is_active, true) and coalesce(nullif(trim(er.rule_code),''), nullif(trim(er.rule_key),''), '') like 'legacy_rule_%') > 0
        or (select missing_cycle + missing_source + missing_points from malformed_transactions) > 0 then 'warning'
      else 'healthy'
    end
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_staff_points_dashboard_v3(uuid,text) from public;
grant execute on function public.get_staff_points_dashboard_v3(uuid,text) to anon, authenticated;
revoke all on function public.get_doctor_incentive_dashboard_v3(uuid) from public;
grant execute on function public.get_doctor_incentive_dashboard_v3(uuid) to anon, authenticated;
revoke all on function public.get_points_architecture_health_v3() from public;
grant execute on function public.get_points_architecture_health_v3() to anon, authenticated;

comment on function public.get_staff_points_dashboard_v3(uuid,text) is
  'Fast canonical staff points dashboard. Financial values are null until a compensation profile is configured; this prevents accidental fallback payouts.';
comment on function public.get_doctor_incentive_dashboard_v3(uuid) is
  'One-RPC doctor dashboard: canonical points truth + monetary bonuses + pillar breakdown.';

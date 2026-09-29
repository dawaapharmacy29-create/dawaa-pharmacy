-- Monthly evaluation V3 truth guard.
-- Final evaluation is only valid after the 26 -> 25 cycle closes.
-- Evaluation + incentive multiplier are synchronized atomically.
-- Payroll-finalized cycles are immutable.

create or replace function public.trg_staff_monthly_evaluation_finalization_guard_v3()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_cycle_end date;
  v_today_cairo date;
  v_finalized boolean := false;
begin
  v_cycle_end := (date_trunc('month', new.evaluation_month)::date + interval '24 days')::date;
  v_today_cairo := (now() at time zone 'Africa/Cairo')::date;

  select exists(
    select 1
    from public.payroll_finalized_snapshots_v2 f
    where f.staff_id = new.staff_id
      and f.month_cycle = to_char(new.evaluation_month, 'YYYY-MM')
  ) into v_finalized;

  if v_finalized then
    raise exception 'monthly_evaluation_payroll_finalized_immutable'
      using errcode='55000',
            detail='The payroll snapshot for this staff member and cycle is finalized. Use the payroll adjustment/reopen workflow instead of rewriting the evaluation.';
  end if;

  if tg_op='UPDATE'
     and old.status in ('sent','approved')
     and new.status not in ('sent','approved') then
    raise exception 'monthly_evaluation_final_status_regression_not_allowed'
      using errcode='55000';
  end if;

  if new.status in ('sent','approved') and v_today_cairo <= v_cycle_end then
    raise exception 'monthly_evaluation_cycle_still_open'
      using errcode='55000',
            detail='Final monthly evaluation is available after the end of day 25 in Cairo time.';
  end if;

  return new;
end;
$function$;

drop trigger if exists staff_monthly_evaluation_finalization_guard_v3
  on public.staff_monthly_manager_evaluations;

create trigger staff_monthly_evaluation_finalization_guard_v3
before insert or update on public.staff_monthly_manager_evaluations
for each row
execute function public.trg_staff_monthly_evaluation_finalization_guard_v3();

create or replace function public.save_staff_monthly_evaluation_v3(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_actor_id uuid;
  v_staff_id uuid;
  v_month date;
  v_month_cycle text;
  v_status text;
  v_score numeric;
  v_cycle_end date;
  v_prior_status text;
  v_prior_sent_at timestamptz;
  v_id uuid;
  v_final_sent_at timestamptz;
  v_reapproved_after_cycle_close boolean := false;
begin
  if p_payload is null then
    raise exception 'invalid_monthly_evaluation_v3_input' using errcode='22023';
  end if;

  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null then
    raise exception 'active_staff_actor_required' using errcode='42501';
  end if;

  v_staff_id := nullif(p_payload->>'staff_id','')::uuid;
  v_month := nullif(p_payload->>'evaluation_month','')::date;
  v_status := coalesce(nullif(trim(p_payload->>'status'),''),'draft');
  v_score := round(coalesce((p_payload->>'overall_score')::numeric,0),2);

  if v_staff_id is null or v_month is null then
    raise exception 'monthly_evaluation_staff_and_cycle_required' using errcode='22023';
  end if;

  if v_status not in ('draft','sent','approved') then
    raise exception 'invalid_monthly_evaluation_status' using errcode='22023';
  end if;

  if v_score < 0 or v_score > 100 then
    raise exception 'invalid_monthly_evaluation_score' using errcode='22023';
  end if;

  v_month_cycle := to_char(v_month,'YYYY-MM');
  v_cycle_end := (date_trunc('month', v_month)::date + interval '24 days')::date;

  select e.status, e.sent_at
  into v_prior_status, v_prior_sent_at
  from public.staff_monthly_manager_evaluations e
  where e.staff_id=v_staff_id
    and e.evaluation_month=v_month
  for update;

  if v_prior_status in ('sent','approved') and v_status='draft' then
    raise exception 'monthly_evaluation_final_status_regression_not_allowed'
      using errcode='55000';
  end if;

  -- V1 remains the authorization/branch-scope authority. The table trigger above
  -- enforces cycle-close and payroll-freeze invariants for every write path.
  v_id := public.save_staff_monthly_evaluation_safe(v_actor_id,p_payload);

  if v_status in ('sent','approved') then
    v_reapproved_after_cycle_close :=
      v_prior_sent_at is not null
      and (v_prior_sent_at at time zone 'Africa/Cairo')::date <= v_cycle_end;

    if v_reapproved_after_cycle_close then
      update public.staff_monthly_manager_evaluations e
      set
        metrics_snapshot = coalesce(e.metrics_snapshot,'{}'::jsonb)
          || jsonb_build_object(
            'initial_sent_at',
              coalesce(e.metrics_snapshot->'initial_sent_at', to_jsonb(v_prior_sent_at)),
            'reapproved_after_cycle_close_at', to_jsonb(now())
          ),
        sent_at = now(),
        updated_at = now()
      where e.id=v_id;
    end if;

    insert into public.staff_evaluation_incentive_multipliers(
      staff_id,month_cycle,multiplier_pct,source_evaluation_id,updated_at
    ) values(
      v_staff_id,v_month_cycle,v_score,v_id,now()
    )
    on conflict(staff_id,month_cycle) do update set
      multiplier_pct=excluded.multiplier_pct,
      source_evaluation_id=excluded.source_evaluation_id,
      updated_at=excluded.updated_at;
  end if;

  select e.sent_at
  into v_final_sent_at
  from public.staff_monthly_manager_evaluations e
  where e.id=v_id;

  return jsonb_build_object(
    'evaluation_id',v_id,
    'status',v_status,
    'month_cycle',v_month_cycle,
    'multiplier_applied',v_status in ('sent','approved'),
    'multiplier_pct',case when v_status in ('sent','approved') then v_score else null end,
    'multiplier_reason',case
      when v_status in ('sent','approved') then 'multiplier_synced'
      else 'evaluation_not_final'
    end,
    'reapproved_after_cycle_close',v_reapproved_after_cycle_close,
    'sent_at',v_final_sent_at
  );
end;
$function$;

revoke execute on function public.save_staff_monthly_evaluation_v3(jsonb)
  from public,anon;
grant execute on function public.save_staff_monthly_evaluation_v3(jsonb)
  to authenticated,service_role;

-- Keep V2 callers safe during rollout: route them through the new canonical command.
create or replace function public.save_staff_monthly_evaluation_v2(
  p_payload jsonb
)
returns jsonb
language sql
security definer
set search_path to 'public','pg_catalog'
as $function$
  select public.save_staff_monthly_evaluation_v3(p_payload);
$function$;

revoke execute on function public.save_staff_monthly_evaluation_v2(jsonb)
  from public,anon;
grant execute on function public.save_staff_monthly_evaluation_v2(jsonb)
  to authenticated,service_role;

-- V2 backfilled legacy "sent" evaluations without knowing whether the cycle had
-- actually ended. Remove only those premature multipliers that are still mutable.
delete from public.staff_evaluation_incentive_multipliers m
using public.staff_monthly_manager_evaluations e
where m.staff_id=e.staff_id
  and m.month_cycle=to_char(e.evaluation_month,'YYYY-MM')
  and m.source_evaluation_id=e.id
  and e.sent_at is not null
  and (e.sent_at at time zone 'Africa/Cairo')::date
      <= (date_trunc('month',e.evaluation_month)::date + interval '24 days')::date
  and not exists(
    select 1
    from public.payroll_finalized_snapshots_v2 f
    where f.staff_id=e.staff_id
      and f.month_cycle=to_char(e.evaluation_month,'YYYY-MM')
  );

revoke insert,update,delete on table public.staff_evaluation_incentive_multipliers
  from public,anon,authenticated;

comment on function public.save_staff_monthly_evaluation_v3(jsonb)
  is 'Canonical V3 monthly evaluation command: close-cycle guard + atomic multiplier sync + payroll immutability.';

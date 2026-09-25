-- Monthly evaluation V2 atomic incentive multiplier cutover.
-- Saves the evaluation and its first financial multiplier in one server transaction.

create or replace function public.save_staff_monthly_evaluation_v2(
  p_actor_id uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_staff_id uuid;
  v_month date;
  v_month_cycle text;
  v_status text;
  v_score numeric;
  v_prior_sent_at timestamptz;
  v_id uuid;
  v_has_multiplier boolean:=false;
  v_finalized boolean:=false;
  v_multiplier_applied boolean:=false;
begin
  if p_actor_id is null or p_payload is null then
    raise exception 'invalid_monthly_evaluation_v2_input' using errcode='22023';
  end if;

  v_staff_id:=(p_payload->>'staff_id')::uuid;
  v_month:=(p_payload->>'evaluation_month')::date;
  v_status:=coalesce(nullif(trim(p_payload->>'status'),''),'draft');
  v_score:=round(coalesce((p_payload->>'overall_score')::numeric,0),2);
  v_month_cycle:=to_char(v_month,'YYYY-MM');

  if v_score<0 or v_score>100 then
    raise exception 'invalid_monthly_evaluation_score' using errcode='22023';
  end if;

  select e.sent_at
  into v_prior_sent_at
  from public.staff_monthly_manager_evaluations e
  where e.staff_id=v_staff_id and e.evaluation_month=v_month
  limit 1;

  select exists(
    select 1
    from public.staff_evaluation_incentive_multipliers m
    where m.staff_id=v_staff_id and m.month_cycle=v_month_cycle
  ) into v_has_multiplier;

  select exists(
    select 1
    from public.payroll_finalized_snapshots_v2 f
    where f.staff_id=v_staff_id and f.month_cycle=v_month_cycle
  ) into v_finalized;

  -- Existing V1 function remains the authorization/scope authority for the evaluation.
  v_id:=public.save_staff_monthly_evaluation_safe(p_actor_id,p_payload);

  if v_status='sent' and not v_has_multiplier then
    if v_finalized then
      -- Evaluation content can remain auditable, but frozen payroll is immutable.
      return jsonb_build_object(
        'evaluation_id',v_id,
        'status',v_status,
        'first_finalization',v_prior_sent_at is null,
        'multiplier_applied',false,
        'multiplier_reason','payroll_finalized_immutable',
        'month_cycle',v_month_cycle
      );
    end if;

    insert into public.staff_evaluation_incentive_multipliers(
      staff_id,month_cycle,multiplier_pct,source_evaluation_id,updated_at
    ) values(
      v_staff_id,v_month_cycle,v_score,v_id,now()
    )
    on conflict(staff_id,month_cycle) do nothing;

    get diagnostics v_multiplier_applied = row_count;
  end if;

  return jsonb_build_object(
    'evaluation_id',v_id,
    'status',v_status,
    'first_finalization',v_status='sent' and v_prior_sent_at is null,
    'multiplier_applied',v_multiplier_applied,
    'multiplier_pct',case when v_status='sent' then v_score else null end,
    'multiplier_reason',case
      when v_status<>'sent' then 'evaluation_not_sent'
      when v_finalized then 'payroll_finalized_immutable'
      when v_has_multiplier then 'existing_multiplier_preserved'
      when v_multiplier_applied then 'first_sent_multiplier_created'
      else 'multiplier_already_created_concurrently'
    end,
    'month_cycle',v_month_cycle
  );
end;
$function$;

revoke execute on function public.save_staff_monthly_evaluation_v2(uuid,jsonb)
  from public,anon;
grant execute on function public.save_staff_monthly_evaluation_v2(uuid,jsonb)
  to authenticated,service_role;

-- Backfill sent evaluations that never received a multiplier under the old split UI flow.
insert into public.staff_evaluation_incentive_multipliers(
  staff_id,month_cycle,multiplier_pct,source_evaluation_id,updated_at
)
select
  e.staff_id,
  to_char(e.evaluation_month,'YYYY-MM'),
  round(coalesce(e.overall_score,0),2),
  e.id,
  now()
from public.staff_monthly_manager_evaluations e
where (e.sent_at is not null or e.status='sent')
  and coalesce(e.overall_score,0) between 0 and 100
  and not exists(
    select 1
    from public.staff_evaluation_incentive_multipliers m
    where m.staff_id=e.staff_id
      and m.month_cycle=to_char(e.evaluation_month,'YYYY-MM')
  )
  and not exists(
    select 1
    from public.payroll_finalized_snapshots_v2 f
    where f.staff_id=e.staff_id
      and f.month_cycle=to_char(e.evaluation_month,'YYYY-MM')
  )
on conflict(staff_id,month_cycle) do nothing;

-- Financial multiplier writes must now pass through the atomic command.
revoke insert,update,delete on table public.staff_evaluation_incentive_multipliers
  from public,anon,authenticated;

comment on function public.save_staff_monthly_evaluation_v2(uuid,jsonb)
  is 'Canonical monthly evaluation command: evaluation save + first incentive multiplier are atomic; finalized payroll is immutable.';

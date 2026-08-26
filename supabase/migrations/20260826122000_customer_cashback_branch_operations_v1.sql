-- Branch-level operational metrics for customer cashback / points cycles.
-- Read-only reporting RPC; respects the same customer-points branch access guard.
-- Retire the historical 30-Jul header so it can never be selected as a previous official cycle.

update public.customer_cashback_periods
set period_type='legacy', updated_at=now()
where period_end=date '2026-07-30' and period_type='official';

create or replace function public.dawaa_customer_cashback_branch_operations_v1(
  p_branch text,
  p_reference_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_branch text := trim(coalesce(p_branch,''));
  v_current record;
  v_previous record;
  v_result jsonb;
begin
  if v_branch = '' or not public.dawaa_can_access_customer_points_branch_v1(v_branch, false) then
    raise exception 'permission denied for customer cashback branch';
  end if;

  select p.* into v_current
  from public.customer_cashback_periods p
  where trim(p.branch)=v_branch
    and p.period_type='official'
    and p.period_end <= p_reference_date
  order by p.period_end desc, p.updated_at desc
  limit 1;

  if not found then
    return jsonb_build_object('branch',v_branch,'current',null,'previous',null,'curve','[]'::jsonb,'previous_curve','[]'::jsonb);
  end if;

  select p.* into v_previous
  from public.customer_cashback_periods p
  where trim(p.branch)=v_branch
    and p.period_type='official'
    and p.period_end < v_current.period_end
  order by p.period_end desc, p.updated_at desc
  limit 1;

  with cur as (
    select
      count(*)::int total,
      count(*) filter(where c.notified_at is not null)::int notified,
      count(*) filter(where c.settled_at is not null or c.status='settled')::int settled,
      count(*) filter(where coalesce(c.redeemed_value,0)>0 and coalesce(c.remaining_value,0)>0)::int partial,
      count(*) filter(where c.notified_at is not null or coalesce(c.redeemed_value,0)>0 or c.status='settled')::int handled,
      coalesce(sum(c.cashback_value),0)::numeric total_points,
      coalesce(sum(c.redeemed_value),0)::numeric redeemed,
      coalesce(sum(c.remaining_value),0)::numeric remaining,
      avg(greatest(0, extract(epoch from (c.notified_at - ((v_current.period_end + 1)::timestamp at time zone 'Africa/Cairo')))/3600.0)) filter(where c.notified_at is not null) avg_notify_hours,
      avg(greatest(0, extract(epoch from (c.settled_at - ((v_current.period_end + 1)::timestamp at time zone 'Africa/Cairo')))/3600.0)) filter(where c.settled_at is not null) avg_settle_hours
    from public.customer_cashback_cycles c
    where trim(c.branch)=v_branch and c.cycle_start=v_current.period_start and c.cycle_end=v_current.period_end
  ), prev as (
    select
      count(*)::int total,
      count(*) filter(where c.notified_at is not null)::int notified,
      count(*) filter(where c.settled_at is not null or c.status='settled')::int settled,
      count(*) filter(where coalesce(c.redeemed_value,0)>0 and coalesce(c.remaining_value,0)>0)::int partial,
      count(*) filter(where c.notified_at is not null or coalesce(c.redeemed_value,0)>0 or c.status='settled')::int handled,
      coalesce(sum(c.cashback_value),0)::numeric total_points,
      coalesce(sum(c.redeemed_value),0)::numeric redeemed,
      coalesce(sum(c.remaining_value),0)::numeric remaining,
      avg(greatest(0, extract(epoch from (c.notified_at - ((v_previous.period_end + 1)::timestamp at time zone 'Africa/Cairo')))/3600.0)) filter(where c.notified_at is not null) avg_notify_hours,
      avg(greatest(0, extract(epoch from (c.settled_at - ((v_previous.period_end + 1)::timestamp at time zone 'Africa/Cairo')))/3600.0)) filter(where c.settled_at is not null) avg_settle_hours
    from public.customer_cashback_cycles c
    where v_previous.id is not null and trim(c.branch)=v_branch and c.cycle_start=v_previous.period_start and c.cycle_end=v_previous.period_end
  ), curve as (
    select d as day,
      count(*) filter(where c.notified_at is not null and c.notified_at < (((v_current.period_end + 1)::timestamp at time zone 'Africa/Cairo') + make_interval(days=>d)))::int notified_cum,
      count(*) filter(where (c.settled_at is not null or c.status='settled') and coalesce(c.settled_at,c.updated_at) < (((v_current.period_end + 1)::timestamp at time zone 'Africa/Cairo') + make_interval(days=>d)))::int settled_cum
    from generate_series(1,14) d
    cross join public.customer_cashback_cycles c
    where trim(c.branch)=v_branch and c.cycle_start=v_current.period_start and c.cycle_end=v_current.period_end
    group by d order by d
  ), pcurve as (
    select d as day,
      count(*) filter(where c.notified_at is not null and c.notified_at < (((v_previous.period_end + 1)::timestamp at time zone 'Africa/Cairo') + make_interval(days=>d)))::int notified_cum,
      count(*) filter(where (c.settled_at is not null or c.status='settled') and coalesce(c.settled_at,c.updated_at) < (((v_previous.period_end + 1)::timestamp at time zone 'Africa/Cairo') + make_interval(days=>d)))::int settled_cum
    from generate_series(1,14) d
    cross join public.customer_cashback_cycles c
    where v_previous.id is not null and trim(c.branch)=v_branch and c.cycle_start=v_previous.period_start and c.cycle_end=v_previous.period_end
    group by d order by d
  )
  select jsonb_build_object(
    'branch',v_branch,
    'current', jsonb_build_object(
      'period_start',v_current.period_start,'period_end',v_current.period_end,
      'total',cur.total,'notified',cur.notified,'settled',cur.settled,'partial',cur.partial,'handled',cur.handled,
      'pending',greatest(cur.total-cur.handled,0),
      'notification_rate',case when cur.total>0 then round(cur.notified*100.0/cur.total,2) end,
      'handled_rate',case when cur.total>0 then round(cur.handled*100.0/cur.total,2) end,
      'settlement_rate',case when cur.total>0 then round(cur.settled*100.0/cur.total,2) end,
      'redemption_rate',case when cur.total_points>0 then round(cur.redeemed*100.0/cur.total_points,2) end,
      'total_points',round(cur.total_points,2),'redeemed',round(cur.redeemed,2),'remaining',round(cur.remaining,2),
      'avg_notify_hours',round(cur.avg_notify_hours::numeric,2),'avg_settle_hours',round(cur.avg_settle_hours::numeric,2)
    ),
    'previous', case when v_previous.id is null then null else jsonb_build_object(
      'period_start',v_previous.period_start,'period_end',v_previous.period_end,
      'total',prev.total,'notified',prev.notified,'settled',prev.settled,'partial',prev.partial,'handled',prev.handled,
      'pending',greatest(prev.total-prev.handled,0),
      'notification_rate',case when prev.total>0 then round(prev.notified*100.0/prev.total,2) end,
      'handled_rate',case when prev.total>0 then round(prev.handled*100.0/prev.total,2) end,
      'settlement_rate',case when prev.total>0 then round(prev.settled*100.0/prev.total,2) end,
      'redemption_rate',case when prev.total_points>0 then round(prev.redeemed*100.0/prev.total_points,2) end,
      'total_points',round(prev.total_points,2),'redeemed',round(prev.redeemed,2),'remaining',round(prev.remaining,2),
      'avg_notify_hours',round(prev.avg_notify_hours::numeric,2),'avg_settle_hours',round(prev.avg_settle_hours::numeric,2)
    ) end,
    'curve',coalesce((select jsonb_agg(jsonb_build_object('day',day,'notified',notified_cum,'settled',settled_cum) order by day) from curve),'[]'::jsonb),
    'previous_curve',coalesce((select jsonb_agg(jsonb_build_object('day',day,'notified',notified_cum,'settled',settled_cum) order by day) from pcurve),'[]'::jsonb),
    'measurement_note','السرعة تقاس من إغلاق الدورة (بداية اليوم التالي بتوقيت القاهرة) حتى التبليغ/التسوية؛ إعادة الاحتساب لا تغيّر نقطة البداية.'
  ) into v_result
  from cur cross join prev;

  return v_result;
end;
$function$;

revoke all on function public.dawaa_customer_cashback_branch_operations_v1(text,date) from public;
grant execute on function public.dawaa_customer_cashback_branch_operations_v1(text,date) to anon, authenticated;

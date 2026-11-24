-- Delivery OS (qlugjplnnkjzxcbhwopg). Owner decision 2026-11-24: a rider does not have to open a shift. A registered
-- order whose invoice number matches a management invoice is final. That covers riders without a fingerprint and the
-- x1.5 orders as well: they are approved with their invoice and set aside for a weekly random review instead of
-- waiting for a manager.
-- Replaces the fingerprint condition of 20261124120000 (the fingerprint days keep syncing, for reference only).
-- Still held: orders without a matched invoice, duplicates, and failed / cancelled / returned orders.
-- Applied live 2026-11-24: the first run had no cycle bound and released 747 orders of closed cycles; they were restored
-- from backup_invoice_final_release_20261124 with an invoice_match_final_reverted_v1 audit row each. 594 orders of the
-- open cycle were released. The release is limited to the open cycle since.

create table if not exists public.backup_invoice_final_release_20261124 as
select id, needs_review, review_reason, review_status, approval_status, final_count_status, security_flags, now() as backed_up_at
from public.delivery_orders where false;

create or replace function public.dawaa_release_invoice_matched_orders_v1(p_limit integer default 1000)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare v_n integer := 0; v_today date := (now() at time zone 'Africa/Cairo')::date; v_cycle_start date;
begin
  -- Only the open pay cycle (26th to 25th): closed cycles were already paid and stay as they were.
  v_cycle_start := case when extract(day from v_today) >= 26 then make_date(extract(year from v_today)::int, extract(month from v_today)::int, 26)
                        else (make_date(extract(year from v_today)::int, extract(month from v_today)::int, 26) - interval '1 month')::date end;
  with ready as (
    select o.id, o.review_reason, o.final_count_status, o.reconciliation_status,
           (o.attendance_id is null) as no_shift, coalesce(o.order_multiplier, 1) >= 1.5 as is_x15
    from public.delivery_orders o
    where o.needs_review is true and o.review_reason in ('missing_shift', 'multiplier_order')
      and o.delivery_date >= v_cycle_start
      and o.final_count_status like 'counted%'
      and o.bconnect_match_status in ('matched', 'manually_approved', 'cross_branch_matched')
      and o.reconciliation_status is distinct from 'duplicate_in_app'
      and lower(coalesce(o.status, '')) not in ('failed', 'cancelled', 'canceled', 'returned')
      and o.rider_id is not null and o.deleted_at is null and coalesce(o.is_deleted, false) = false
      and coalesce(o.is_duplicate_invoice, false) = false and coalesce(o.duplicate_warning, false) = false
      and o.original_order_id is null and o.settlement_batch_id is null
      and coalesce(o.not_countable, false) = false and coalesce(o.excluded_from_incentive, false) = false
    order by o.delivery_date, o.id
    limit p_limit
    for update of o skip locked
  ), backup as (
    insert into public.backup_invoice_final_release_20261124
    select o.id, o.needs_review, o.review_reason, o.review_status, o.approval_status, o.final_count_status, o.security_flags, now()
    from public.delivery_orders o join ready r on r.id = o.id
    returning 1
  ), released as (
    update public.delivery_orders o set
      needs_review = false, review_reason = null,
      review_status = 'auto_approved_invoice',
      approval_status = case when r.is_x15 then 'approved' else o.approval_status end,
      final_count_status = case when o.final_count_status = 'counted_multiplier_pending_value_review'
                                then 'counted_multiplier_invoice_approved' else o.final_count_status end,
      security_flags = coalesce(o.security_flags, '{}'::jsonb) || jsonb_build_object('invoice_auto_approval_v1', jsonb_build_object(
        'at', now(), 'old_review_reason', r.review_reason, 'x1_5', r.is_x15, 'no_shift', r.no_shift,
        'name_mismatch', r.reconciliation_status = 'matched_customer_name_mismatch')),
      updated_at = now()
    from ready r where o.id = r.id and (select count(*) from backup) >= 0
    returning o.id, o.invoice_number, o.rider_id, o.delivery_date, r.review_reason, r.is_x15
  ), audited as (
    insert into public.delivery_order_audit_log (delivery_order_id, action_type, action_reason, old_rider_id, new_rider_id, performed_by_name, payload)
    select x.id::uuid, 'invoice_match_final_v1',
      'Owner rule: a registered order with a matched invoice is final; set aside for the weekly random review',
      x.rider_id, x.rider_id, 'DAWAA invoice match',
      jsonb_build_object('invoice_number', x.invoice_number, 'delivery_date', x.delivery_date,
                         'old_review_reason', x.review_reason, 'x1_5', x.is_x15)
    from released x
    returning 1
  )
  select count(*) into v_n from audited;
  return v_n;
end;
$function$;
revoke all on function public.dawaa_release_invoice_matched_orders_v1(integer) from public, anon, authenticated;

-- The fingerprint release is superseded by the invoice rule.
do $$ begin perform cron.unschedule('dawaa-release-fingerprint-verified-orders-v1'); exception when others then null; end $$;
select cron.schedule('dawaa-release-invoice-matched-orders-v1', '*/5 * * * *',
  'select public.dawaa_release_invoice_matched_orders_v1(1000);');

-- Weekly random review: every Saturday, up to 5 auto-approved orders of the past 7 days per rider
-- (x1.5 first, then orders without a shift or with a different customer name, then any).
create table if not exists public.order_spot_checks_v1 (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  rider_id uuid not null,
  delivery_order_id text not null,
  pick_reason text not null,
  result text not null default 'pending' check (result in ('pending', 'ok', 'issue')),
  note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (week_start, delivery_order_id)
);
alter table public.order_spot_checks_v1 enable row level security;
revoke all on public.order_spot_checks_v1 from anon, authenticated;

create or replace function public.dawaa_pick_weekly_spot_checks_v1(p_week_start date default null, p_per_rider integer default 5)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare v_week date; v_n integer;
begin
  -- The review week is the 7 days before the Saturday it is picked on.
  v_week := coalesce(p_week_start, (now() at time zone 'Africa/Cairo')::date - 7);
  insert into public.order_spot_checks_v1 (week_start, rider_id, delivery_order_id, pick_reason)
  select v_week, x.rider_id, x.id, x.reason
  from (
    select o.rider_id, o.id,
      case when (o.security_flags->'invoice_auto_approval_v1'->>'x1_5')::boolean then 'x1_5'
           when (o.security_flags->'invoice_auto_approval_v1'->>'name_mismatch')::boolean then 'name_mismatch'
           when (o.security_flags->'invoice_auto_approval_v1'->>'no_shift')::boolean then 'no_shift'
           else 'random' end as reason,
      row_number() over (partition by o.rider_id order by
        case when (o.security_flags->'invoice_auto_approval_v1'->>'x1_5')::boolean then 0 else 1 end, random()) as rn
    from public.delivery_orders o
    where o.security_flags ? 'invoice_auto_approval_v1'
      and o.delivery_date between v_week and v_week + 6
      and o.deleted_at is null and coalesce(o.needs_review, false) = false and o.rider_id is not null
      and not exists (select 1 from public.order_spot_checks_v1 c where c.week_start = v_week and c.rider_id = o.rider_id)
  ) x
  where x.rn <= greatest(1, least(coalesce(p_per_rider, 5), 20))
  on conflict (week_start, delivery_order_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;
revoke all on function public.dawaa_pick_weekly_spot_checks_v1(date, integer) from public, anon, authenticated;
select cron.schedule('dawaa-weekly-order-spot-checks-v1', '0 6 * * 6', 'select public.dawaa_pick_weekly_spot_checks_v1();');

create or replace function public.admin_order_spot_checks_v1(p_token text, p_week_start date default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_week date;
begin
  perform dawaa_private.assert_delivery_reconciliation_manager_v1(p_token);
  v_week := coalesce(p_week_start, (select max(week_start) from public.order_spot_checks_v1));
  return jsonb_build_object(
    'week_start', v_week,
    'weeks', coalesce((select jsonb_agg(w order by w desc) from (select distinct week_start w from public.order_spot_checks_v1) q), '[]'::jsonb),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'id', c.id, 'rider_id', c.rider_id, 'rider_name', r.name, 'branch_name', coalesce(o.branch_name, r.branch_name),
        'order_id', o.id, 'invoice_number', o.invoice_number, 'delivery_date', o.delivery_date,
        'customer_name', o.customer_name, 'customer_code', o.customer_code, 'invoice_value', o.invoice_value,
        'order_multiplier', o.order_multiplier, 'status', o.status, 'pick_reason', c.pick_reason,
        'result', c.result, 'note', c.note, 'reviewed_by', c.reviewed_by, 'reviewed_at', c.reviewed_at)
        order by r.name, o.delivery_date)
      from public.order_spot_checks_v1 c
      join public.delivery_orders o on o.id = c.delivery_order_id
      left join public.riders r on r.id = c.rider_id
      where c.week_start = v_week), '[]'::jsonb));
end;
$function$;
revoke all on function public.admin_order_spot_checks_v1(text, date) from public;
grant execute on function public.admin_order_spot_checks_v1(text, date) to anon, authenticated;

-- 'issue' sends the order back to review (out of payroll) until it is decided in reconciliation.
create or replace function public.admin_decide_order_spot_check_v1(p_token text, p_id uuid, p_result text, p_note text default null, p_reviewer text default null)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare c public.order_spot_checks_v1;
begin
  perform dawaa_private.assert_delivery_reconciliation_manager_v1(p_token);
  if p_result not in ('ok', 'issue') then raise exception 'invalid_result' using errcode = '22023'; end if;
  if p_result = 'issue' and coalesce(length(btrim(p_note)), 0) < 3 then raise exception 'issue_note_required' using errcode = '22023'; end if;
  update public.order_spot_checks_v1 set result = p_result, note = nullif(btrim(coalesce(p_note, '')), ''),
    reviewed_by = nullif(btrim(coalesce(p_reviewer, '')), ''), reviewed_at = now()
  where id = p_id returning * into c;
  if c.id is null then raise exception 'spot_check_not_found' using errcode = 'P0002'; end if;
  if p_result = 'issue' then
    update public.delivery_orders set needs_review = true, review_reason = 'spot_check_issue', review_status = 'pending', updated_at = now()
    where id = c.delivery_order_id and settlement_batch_id is null;
  end if;
  insert into public.delivery_order_audit_log (delivery_order_id, action_type, action_reason, performed_by_name, payload)
  values (c.delivery_order_id::uuid, 'spot_check_' || p_result, coalesce(nullif(btrim(p_note), ''), 'weekly spot check'),
          coalesce(nullif(btrim(p_reviewer), ''), 'الإدارة'), jsonb_build_object('spot_check_id', c.id, 'week_start', c.week_start));
  return jsonb_build_object('id', c.id, 'result', c.result);
end;
$function$;
revoke all on function public.admin_decide_order_spot_check_v1(text, uuid, text, text, text) from public;
grant execute on function public.admin_decide_order_spot_check_v1(text, uuid, text, text, text) to anon, authenticated;

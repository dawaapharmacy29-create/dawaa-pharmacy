-- Delivery OS (qlugjplnnkjzxcbhwopg). Owner request 2026-11-24: the owner reviews delivery orders against the
-- management invoices, so an order whose invoice matched exactly is final. 1204 such orders were still held
-- (needs_review, review_reason='missing_shift') only because the rider never opens a shift in the delivery app
-- (all الشامي riders and حجازي), so payroll did not count them.
-- The management app now pushes each mapped rider's fingerprint days (attendance_daily_summary with a check-in)
-- every 15 minutes. An invoice-matched, counted order held only for a missing shift is released when the rider has a
-- fingerprint that day (or the previous day, for a delivery after midnight). Multiplier orders, duplicates, failed
-- orders and orders without a matched invoice are untouched and stay for manual review.

create table if not exists public.rider_fingerprint_days_v1 (
  rider_id uuid not null,
  work_day date not null,
  first_in timestamptz,
  last_out timestamptz,
  synced_at timestamptz not null default now(),
  primary key (rider_id, work_day)
);
alter table public.rider_fingerprint_days_v1 enable row level security;
revoke all on public.rider_fingerprint_days_v1 from anon, authenticated;

create or replace function public.dawaa_release_fingerprint_verified_orders_v1(p_limit integer default 2000)
returns integer
language plpgsql
security definer
set search_path to ''
as $function$
declare v_n integer := 0;
begin
  with ready as (
    select o.id
    from public.delivery_orders o
    where o.review_reason = 'missing_shift' and o.needs_review is true and o.attendance_id is null
      and o.final_count_status = 'counted' and o.reconciliation_status = 'matched' and o.bconnect_match_status = 'matched'
      and o.bconnect_invoice_id is not null and o.rider_id is not null and o.status = 'delivered'
      and o.deleted_at is null and coalesce(o.is_deleted, false) = false
      and coalesce(o.is_duplicate_invoice, false) = false and coalesce(o.duplicate_warning, false) = false
      and o.original_order_id is null and coalesce(o.order_multiplier, 1) = 1 and o.settlement_batch_id is null
      and o.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and exists (select 1 from public.rider_fingerprint_days_v1 f
                  where f.rider_id = o.rider_id
                    and (f.work_day = o.delivery_date
                         or (f.work_day = o.delivery_date - 1
                             and extract(hour from coalesce(o.delivered_at, o.created_at) at time zone 'Africa/Cairo') < 5)))
    order by o.delivery_date, o.id
    limit p_limit
    for update of o skip locked
  ), released as (
    update public.delivery_orders o set needs_review = false, review_reason = null,
      review_status = case when o.review_status = 'missing_shift' then 'pending' else o.review_status end, updated_at = now()
    from ready r where o.id = r.id
    returning o.id, o.invoice_number, o.rider_id, o.delivery_date
  ), audited as (
    insert into public.delivery_order_audit_log (delivery_order_id, action_type, action_reason, old_rider_id, new_rider_id, performed_by_name, payload)
    select x.id::uuid, 'fingerprint_verified_missing_shift_v1',
      'Invoice matched exactly and the rider has a management fingerprint that day; missing app shift no longer blocks',
      x.rider_id, x.rider_id, 'DAWAA invoice + fingerprint verification',
      jsonb_build_object('invoice_number', x.invoice_number, 'delivery_date', x.delivery_date, 'old_review_reason', 'missing_shift')
    from released x
    returning 1
  )
  select count(*) into v_n from audited;
  return v_n;
end;
$function$;
revoke all on function public.dawaa_release_fingerprint_verified_orders_v1(integer) from public, anon, authenticated;

-- Called by the management app (same bridge key as the invoice snapshot). It only stores the days: releasing in the
-- same call ran past the anon statement timeout, so the release runs on its own every 5 minutes (below).
create or replace function public.ingest_rider_fingerprint_days_v1(p_key text, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare v_key text; v_rows integer;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'delivery_invoice_bridge_key';
  if v_key is null or length(coalesce(p_key, '')) < 64 or p_key is distinct from v_key then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) > 20000 then
    raise exception 'invalid_fingerprint_rows' using errcode = '22023';
  end if;
  insert into public.rider_fingerprint_days_v1 (rider_id, work_day, first_in, last_out, synced_at)
  select (r->>'rider_id')::uuid, (r->>'work_day')::date, (r->>'first_in')::timestamptz, (r->>'last_out')::timestamptz, now()
  from jsonb_array_elements(p_rows) r
  where (r->>'rider_id') ~* '^[0-9a-f-]{36}$' and (r->>'work_day') ~ '^\d{4}-\d{2}-\d{2}$'
    and exists (select 1 from public.riders x where x.id = (r->>'rider_id')::uuid)
  on conflict (rider_id, work_day) do update set first_in = excluded.first_in, last_out = excluded.last_out, synced_at = now();
  get diagnostics v_rows = row_count;
  return jsonb_build_object('days', v_rows);
end;
$function$;
revoke all on function public.ingest_rider_fingerprint_days_v1(text, jsonb) from public;
grant execute on function public.ingest_rider_fingerprint_days_v1(text, jsonb) to anon;

select cron.schedule('dawaa-release-fingerprint-verified-orders-v1', '*/5 * * * *',
  'select public.dawaa_release_fingerprint_verified_orders_v1(500);');

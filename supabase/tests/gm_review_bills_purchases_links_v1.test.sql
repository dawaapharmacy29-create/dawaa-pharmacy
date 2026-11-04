-- Purchases, riders and collection transfers in the general manager's daily review.
insert into public.base44_sync_run_log(source, status) values ('purchase_invoices', 'success'), ('bills_ops', 'success');

do $$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v jsonb;
  v_item jsonb;
begin
  -- The Bills settlement ledger (piasters): openings, a reloaded source, two transfers and a confirmed historical one.
  perform public.import_base44_bills_ops_v1(
    jsonb_build_array(
      jsonb_build_object('id', 'b1', 'sequence', 1, 'action', 'setup', 'events_json', jsonb_build_array(
        jsonb_build_object('kind', 'setup', 'id', 's:0', 'config', jsonb_build_object('start_date', '2026-10-29'),
          'openings', jsonb_build_object('vodafone', 100000, 'insta', 50000, 'visa', 0)))::text),
      jsonb_build_object('id', 'b2', 'sequence', 2, 'action', 'load', 'events_json', jsonb_build_array(
        jsonb_build_object('kind', 'source', 'id', 'l:0', 'key', 'shift-a:vodafone', 'source',
          jsonb_build_object('wallet', 'vodafone', 'amount', 20000, 'date', v_today - 1, 'branch', 'فرع زكريا')),
        jsonb_build_object('kind', 'source', 'id', 'l:1', 'key', 'shift-b:insta', 'source',
          jsonb_build_object('wallet', 'insta', 'amount', 10000, 'date', v_today, 'branch', 'فرع المنشية')))::text),
      -- The same shift reloaded with a new amount replaces the first one.
      jsonb_build_object('id', 'b3', 'sequence', 3, 'action', 'load', 'events_json', jsonb_build_array(
        jsonb_build_object('kind', 'source', 'id', 'r:0', 'key', 'shift-a:vodafone', 'source',
          jsonb_build_object('wallet', 'vodafone', 'amount', 30000, 'date', v_today - 1, 'branch', 'فرع زكريا')))::text),
      jsonb_build_object('id', 'b4', 'sequence', 4, 'action', 'historical_transfer', 'events_json', jsonb_build_array(
        jsonb_build_object('kind', 'historical_transfer', 'id', 'h:0', 'wallet', 'vodafone', 'delta', -999900, 'date', '2026-10-20'),
        jsonb_build_object('kind', 'confirm', 'id', 'c:0', 'target', 'h:0', 'at', '2026-10-29T20:00:00Z'))::text),
      jsonb_build_object('id', 'b5', 'sequence', 5, 'action', 'transfer', 'events_json', jsonb_build_array(
        jsonb_build_object('kind', 'transfer', 'id', 't:0', 'wallet', 'vodafone', 'delta', -40000, 'date', v_today - 3,
          'recipient', 'أ عمرو', 'at', now()),
        jsonb_build_object('kind', 'transfer', 'id', 't:1', 'wallet', 'insta', 'delta', -5000, 'date', v_today,
          'recipient', 'أ عمرو', 'at', now()))::text)),
    -- A trip open for 20 hours, and a closed one.
    jsonb_build_array(
      jsonb_build_object('id', 'trip-1', 'rider_name', 'مندوب', 'branch', 'فرع زكريا', 'start_time', now() - interval '20 hours',
        'end_time', null, 'updated_date', '2026-11-01T00:00:00'),
      jsonb_build_object('id', 'trip-2', 'rider_name', 'مندوب', 'branch', 'فرع بسيسة', 'start_time', now() - interval '30 hours',
        'end_time', now() - interval '28 hours', 'updated_date', '2026-11-01T00:00:00')),
    jsonb_build_array(
      jsonb_build_object('id', 'st-1', 'trip_id', 'trip-1', 'branch', 'فرع زكريا', 'stop_type', 'أوردر', 'approval_status', 'pending',
        'stop_start_time', ((v_today - 1)::timestamp + interval '15 hours') at time zone 'Africa/Cairo', 'updated_date', '2026-11-01T00:00:00'),
      jsonb_build_object('id', 'st-2', 'trip_id', 'trip-2', 'branch', 'فرع بسيسة', 'stop_type', 'أوردر', 'approval_status', 'approved',
        'stop_start_time', ((v_today - 1)::timestamp + interval '15 hours') at time zone 'Africa/Cairo', 'updated_date', '2026-11-01T00:00:00'),
      jsonb_build_object('id', 'st-3', 'trip_id', 'trip-2', 'branch', 'فرع بسيسة', 'stop_type', 'مشوار', 'approval_status', 'cancelled',
        'stop_start_time', ((v_today - 1)::timestamp + interval '16 hours') at time zone 'Africa/Cairo', 'updated_date', '2026-11-01T00:00:00'),
      jsonb_build_object('id', 'st-sample', 'branch', 'فرع بسيسة', 'approval_status', 'pending', 'is_sample', true,
        'stop_start_time', '2026-10-01T10:00:00Z', 'updated_date', '2026-11-01T00:00:00')));

  v := public.collection_settlement_state_v1();
  -- vodafone 1000 + 300 − 400 = 900; insta 500 + 100 − 50 = 550; the historical transfer is out of the balance.
  if (v->'wallets'->0->>'balance')::numeric <> 900 or (v->'wallets'->1->>'balance')::numeric <> 550
     or (v->'wallets'->2->>'balance')::numeric <> 0 then
    raise exception 'balances: %', v->'wallets';
  end if;
  if jsonb_array_length(v->'pending') <> 2 or (v->'pending'->0->>'days')::int <> 3 or (v->'pending'->0->>'amount')::numeric <> 400 then
    raise exception 'pending: %', v->'pending';
  end if;
  if jsonb_array_length(v->'confirmed') <> 1 or not (v->'confirmed'->0->>'historical')::boolean then
    raise exception 'confirmed: %', v->'confirmed';
  end if;
  if (v->'collected'->>'today')::numeric <> 100 or (v->'collected'->>'yesterday')::numeric <> 300 then
    raise exception 'collected: %', v->'collected';
  end if;

  -- An empty ledger answer keeps the copy.
  perform public.import_base44_bills_ops_v1('[]', '[]', '[]');
  if (select count(*) from public.bills_collection_batches) <> 5 then raise exception 'ledger_wiped'; end if;
  if exists (select 1 from public.bills_trip_stops where base44_id = 'st-sample') then raise exception 'sample_imported'; end if;
end;
$$;

set role anon;
do $$
declare
  v jsonb;
  v_item jsonb;
begin
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000001', true);
  v := public.get_gm_daily_review_v1();

  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'purchases_handover';
  if (v_item->>'ok')::boolean or v_item ? 'url'
     or (v_item->'detail'->'branches'->0->>'pending')::int <> 0
     or (v_item->'detail'->'branches'->1->>'pending')::int <> 1
     or (v_item->'detail'->'branches'->1->>'value')::numeric <> 1500
     or (v_item->'detail'->'branches'->1->>'yesterday')::int <> 2 then
    raise exception 'purchases: %', v_item;
  end if;

  -- Since 20261104120000 the daily review no longer reads Dawaa Bills: riders come from the delivery app
  -- snapshot (none stored here → not ok, no branches) and transfers from DawaaWael shift handovers.
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'delivery';
  if (v_item->>'ok')::boolean or v_item ? 'url' or jsonb_array_length(v_item->'detail'->'branches') <> 0 then
    raise exception 'delivery: %', v_item;
  end if;

  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'collection_transfers';
  if (v_item->>'ok')::boolean or v_item->'detail' ? 'balance' then
    raise exception 'collections: %', v_item;
  end if;
  if (v->>'total')::int <> 10 then raise exception 'total: %', v->>'total'; end if;

  perform public.mark_gm_daily_review_item_v1('collection_transfers', 'done');
  v := public.get_gm_daily_review_v1();
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'collection_transfers';
  if not (v_item->>'done')::boolean then
    raise exception 'collections_marked: %', v_item;
  end if;

  if jsonb_array_length(public.get_collection_settlement_v1()->'wallets') <> 3 then raise exception 'report'; end if;

  -- The ledger copies and the internal state stay closed to the browser.
  begin
    perform count(*) from public.bills_collection_batches;
    raise exception 'anon_read_ledger';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.collection_settlement_state_v1();
    raise exception 'state_exposed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.import_base44_bills_ops_v1('[]', '[]', '[]');
    raise exception 'import_exposed';
  exception when insufficient_privilege then null;
  end;

  -- A branch manager does not read the settlement.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000002', true);
  begin
    perform public.get_collection_settlement_v1();
    raise exception 'branch_manager_read_settlement';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Shift handovers from Base44: import, the shifts due at a moment, and the review item.
do $$
declare
  v jsonb;
  v_item jsonb;
  v_n integer;
  rec jsonb := '[]'::jsonb;
  r record;
begin
  -- Only the service role imports.
  if has_function_privilege('anon', 'public.import_base44_shift_deliveries_v1(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.import_base44_shift_deliveries_v1(jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.import_base44_shift_deliveries_v1(jsonb)', 'execute') then
    raise exception 'import_grants_wrong';
  end if;

  -- At 12:00 Cairo on 2 Nov the shifts due in the last 48 hours: 31 Oct morning and evening, all of
  -- 1 Nov, and 2 Nov night — six per branch.
  select count(*) into v_n from public.shift_handover_due_v1(timestamptz '2026-11-02 12:00+02');
  if v_n <> 12 then raise exception 'due_count: %', v_n; end if;
  if exists (select 1 from public.shift_handover_due_v1(timestamptz '2026-11-02 12:00+02')
              where (shift_date, shift_type) in (('2026-10-31', 'ليلي'), ('2026-11-02', 'صباحي'))) then
    raise exception 'due_window_wrong';
  end if;

  -- Shokry closes all six; Al-Shami misses 1 Nov evening (its only handover for it is archived).
  for r in select * from public.shift_handover_due_v1(timestamptz '2026-11-02 12:00+02') loop
    if not (r.branch = 'فرع الشامي' and r.shift_date = '2026-11-01' and r.shift_type = 'مسائي') then
      rec := rec || jsonb_build_object('id', 'b44-' || r.branch || r.shift_date || r.shift_type, 'branch', r.branch,
        'shift_type', r.shift_type, 'shift_date', r.shift_date, 'submitted_by', 'د تجربة', 'total_sales', 1000,
        'net_amount', 900, 'total_expenses', 100, 'cash_sales', 700, 'visa_sales', 300, 'cash_variance', 0,
        'expenses', '[{"category":"مواصلات","amount":100}]'::jsonb, 'created_date', '2026-11-02T08:00:00.000000');
    end if;
  end loop;
  rec := rec || jsonb_build_object('id', 'b44-archived', 'branch', 'فرع الشامي', 'shift_type', 'مسائي',
    'shift_date', '2026-11-01', 'is_archived', true, 'total_sales', 50)
             || jsonb_build_object('id', 'b44-other', 'branch', 'دواء شكري', 'shift_type', 'ليلي', 'shift_date', '2026-11-01');
  v := public.import_base44_shift_deliveries_v1(rec);
  if (v->>'upserted')::int <> 12 then raise exception 'import_count: %', v; end if;

  select count(*) into v_n from public.shift_handover_due_v1(timestamptz '2026-11-02 12:00+02') where not closed;
  if v_n <> 1 then raise exception 'missing_count: %', v_n; end if;
  if not exists (select 1 from public.shift_handover_due_v1(timestamptz '2026-11-02 12:00+02')
                  where not closed and branch = 'فرع الشامي' and shift_date = '2026-11-01' and shift_type = 'مسائي') then
    raise exception 'missing_wrong';
  end if;

  -- Re-import updates in place, keeping the payment split and the UTC time.
  perform public.import_base44_shift_deliveries_v1(jsonb_build_array(rec->0 || '{"net_amount": 950}'::jsonb));
  select count(*) into v_n from public.shift_handovers where base44_id like 'b44-%';
  if v_n <> 12 then raise exception 'reimport_duplicated: %', v_n; end if;
  if not exists (select 1 from public.shift_handovers where base44_id = rec->0->>'id' and net_amount = 950
                  and cash_sales = 700 and base44_created_at = timestamptz '2026-11-02 08:00Z') then
    raise exception 'reimport_not_updated';
  end if;

  -- The review item: red with no successful sync in the last hour.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000001', true);
  v := public.get_gm_daily_review_v1();
  if (v->>'total')::int <> 9 then raise exception 'review_total: %', v->>'total'; end if;
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'shifts';
  if v_item is null or (v_item->>'ok')::boolean or v_item->'detail'->>'synced_at' is not null then
    raise exception 'shifts_without_sync: %', v_item;
  end if;

  -- A fresh sync and every shift due now closed in both branches: green.
  insert into public.base44_sync_run_log(source, status) values ('shift_deliveries', 'success');
  rec := '[]'::jsonb;
  for r in select * from public.shift_handover_due_v1(now()) loop
    rec := rec || jsonb_build_object('id', 'now-' || r.branch || r.shift_date || r.shift_type, 'branch', r.branch,
      'shift_type', r.shift_type, 'shift_date', r.shift_date);
  end loop;
  perform public.import_base44_shift_deliveries_v1(rec);
  v := public.get_gm_daily_review_v1();
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'shifts';
  if not (v_item->>'ok')::boolean or not (v_item->>'done')::boolean then raise exception 'shifts_not_green: %', v_item; end if;

  -- Archive one Shokry shift (every copy of it): red, and the missing shift is named.
  select * into r from public.shift_handover_due_v1(now()) where branch = 'فرع شكري' order by due_at limit 1;
  update public.shift_handovers set is_archived = true
   where branch = r.branch and shift_date = r.shift_date and shift_type = r.shift_type;
  v := public.get_gm_daily_review_v1();
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'shifts';
  if (v_item->>'ok')::boolean
     or v_item->'detail'->'branches'->1->>'branch' <> 'shokry'
     or v_item->'detail'->'branches'->1->'missing'->0->>'shift' <> r.shift_type
     or (v_item->'detail'->'branches'->1->'missing'->0->>'day')::date <> r.shift_date then
    raise exception 'shifts_missing_not_listed: %', v_item;
  end if;

  -- The general manager can close it by hand like any item.
  perform public.mark_gm_daily_review_item_v1('shifts', 'issue', 'شكري ما قفلش الليلي');
  v := public.get_gm_daily_review_v1();
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'shifts';
  if v_item->>'state' <> 'issue' then raise exception 'shifts_mark_failed: %', v_item; end if;

  -- Purchase sync rows keep their source.
  insert into public.base44_sync_run_log(status) values ('success');
  if (select source from public.base44_sync_run_log where source <> 'shift_deliveries') <> 'purchase_invoices' then
    raise exception 'log_source_default';
  end if;
end;
$$;

-- The browser roles read through RLS only and never write.
set role authenticated;
do $$
begin
  insert into public.shift_handovers(branch, shift_type, shift_date) values ('فرع شكري', 'ليلي', current_date);
  raise exception 'browser_wrote_handover';
exception when insufficient_privilege then null;
end;
$$;
reset role;
set role anon;
do $$
begin
  perform count(*) from public.shift_handovers;
  raise exception 'anon_read_handovers';
exception when insufficient_privilege then null;
end;
$$;
reset role;
do $$
begin
  if has_function_privilege('authenticated', 'public.shift_handover_due_v1(timestamptz)', 'execute') then
    raise exception 'due_fn_exposed';
  end if;
end;
$$;

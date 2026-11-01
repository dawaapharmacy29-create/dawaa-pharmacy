-- The accountant book from Dawaa Bills: full-snapshot import and the top-management report.
do $$
declare
  v jsonb;
  v_vault jsonb;
  tx jsonb := jsonb_build_array(
    jsonb_build_object('id', 't1', 'vault_code', 'shamy', 'date', '2026-10-30', 'direction', 'in', 'amount', 1000,
      'category_group', 'مبيعات', 'created_date', '2026-10-30T10:00:00.000000'),
    jsonb_build_object('id', 't2', 'vault_code', 'shamy', 'date', '2026-11-01', 'direction', 'out', 'amount', 300,
      'category_group', 'موردين', 'classification_override', 'مصروفات'),
    jsonb_build_object('id', 't3', 'vault_code', 'shokry', 'date', '2026-11-01', 'direction', 'in', 'amount', 50),
    -- Voided and sample rows never count.
    jsonb_build_object('id', 't4', 'vault_code', 'shamy', 'date', '2026-11-01', 'direction', 'in', 'amount', 9999, 'voided', true),
    jsonb_build_object('id', 't5', 'vault_code', 'shamy', 'date', '2026-11-01', 'direction', 'in', 'amount', 7777, 'is_sample', true));
  vaults jsonb := jsonb_build_array(
    jsonb_build_object('id', 'v1', 'code', 'shamy', 'name', 'خزنة الشامي', 'opening_balance', -500, 'opening_date', '2026-05-01'),
    jsonb_build_object('id', 'v2', 'code', 'shokry', 'name', 'خزنة شكري القوتلي', 'opening_balance', 100));
begin
  if has_function_privilege('authenticated', 'public.import_base44_accountant_v1(jsonb, jsonb)', 'execute')
     or not has_function_privilege('service_role', 'public.import_base44_accountant_v1(jsonb, jsonb)', 'execute') then
    raise exception 'import_grants_wrong';
  end if;

  v := public.import_base44_accountant_v1(vaults, tx);
  if (v->>'vaults')::int <> 2 or (v->>'transactions')::int <> 3 then raise exception 'import_counts: %', v; end if;
  if (select classification from public.accountant_transactions where base44_id = 't2') <> 'مصروفات'
     or (select classification from public.accountant_transactions where base44_id = 't3') <> 'غير مصنف' then
    raise exception 'classification_wrong';
  end if;

  -- An empty answer from Base44 never wipes the book.
  begin
    perform public.import_base44_accountant_v1(vaults, '[]'::jsonb);
    raise exception 'empty_snapshot_allowed';
  exception when raise_exception then if sqlerrm <> 'empty_snapshot' then raise; end if;
  end;

  -- Re-import: a row deleted there goes here, an edited one updates in place; twice in one transaction works.
  v := public.import_base44_accountant_v1(vaults, ((tx - 2) || jsonb_build_array(tx->0 || '{"amount": 1200}'::jsonb)) - 0);
  v := public.import_base44_accountant_v1(vaults, ((tx - 2) || jsonb_build_array(tx->0 || '{"amount": 1200}'::jsonb)) - 0);
  if (select count(*) from public.accountant_transactions) <> 2
     or (select amount from public.accountant_transactions where base44_id = 't1') <> 1200 then
    raise exception 'snapshot_not_applied: %', v;
  end if;
  v := public.import_base44_accountant_v1(vaults, tx);
  insert into public.base44_sync_run_log(source, status) values ('accountant', 'success');

  -- Only top management reads the report.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000002', true);
  begin
    perform public.get_accountant_report_v1();
    raise exception 'branch_manager_read_report';
  exception when insufficient_privilege then null;
  end;

  perform set_config('test.actor', '00000000-0000-4000-8000-000000000001', true);
  v := public.get_accountant_report_v1();
  -- Balance = opening + in − out: الشامي −500 + 1000 − 300 = 200; شكري 100 + 50 = 150.
  select x into v_vault from jsonb_array_elements(v->'vaults') x where x->>'code' = 'shamy';
  if (v_vault->>'balance')::numeric <> 200 or (v_vault->>'incoming')::numeric <> 1000 or (v_vault->>'outgoing')::numeric <> 300 then
    raise exception 'shamy_balance: %', v_vault;
  end if;
  select x into v_vault from jsonb_array_elements(v->'vaults') x where x->>'code' = 'shokry';
  if (v_vault->>'balance')::numeric <> 150 then raise exception 'shokry_balance: %', v_vault; end if;
  -- The latest month by default, with its movements only.
  if v->>'month' <> '2026-11' or jsonb_array_length(v->'transactions') <> 2 or v->'months' <> '["2026-11", "2026-10"]'::jsonb
     or v->>'synced_at' is null then
    raise exception 'report_month: %', v;
  end if;
  v := public.get_accountant_report_v1('2026-10');
  if jsonb_array_length(v->'transactions') <> 1 then raise exception 'october: %', v; end if;
  begin
    perform public.get_accountant_report_v1('2026-1');
    raise exception 'bad_month_allowed';
  exception when raise_exception then if sqlerrm <> 'invalid_month' then raise; end if;
  end;
end;
$$;

-- The browser never touches the tables directly.
set role authenticated;
do $$
begin
  perform count(*) from public.accountant_transactions;
  raise exception 'browser_read_transactions';
exception when insufficient_privilege then null;
end;
$$;
reset role;

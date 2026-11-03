-- The app's anon session reads the shift handovers and the accountant report; writes stay closed.
do $$
begin
  perform public.import_base44_shift_deliveries_v1(jsonb_build_array(jsonb_build_object('id', 'a-1',
    'branch', 'فرع شكري', 'shift_type', 'صباحي', 'shift_date', '2026-11-01', 'net_amount', 900)));
  perform public.import_base44_accountant_v1(
    jsonb_build_array(jsonb_build_object('id', 'v1', 'code', 'shamy', 'name', 'خزنة الشامي', 'opening_balance', 0)),
    jsonb_build_array(jsonb_build_object('id', 't1', 'vault_code', 'shamy', 'date', '2026-11-01', 'direction', 'in', 'amount', 10)));
end;
$$;

set role anon;
do $$
declare
  v jsonb;
  v_id uuid;
begin
  -- The general manager's session.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000001', true);
  select id into v_id from public.shift_handovers where base44_id = 'a-1';
  if v_id is null then raise exception 'anon_cannot_read_handovers'; end if;
  v := public.get_accountant_report_v1();
  if (v->'vaults'->0->>'balance')::numeric <> 10 then raise exception 'report: %', v; end if;
  if (select count(*) from public.shift_handover_on_duty_v1('2026-11-01', '2026-11-01')) <> 6 then raise exception 'on_duty'; end if;
  perform public.correct_shift_handover_v1(v_id, '{"net_amount": 950}', 'تصحيح');
  if (select count(*) from public.shift_handover_corrections_v1) <> 1 then raise exception 'anon_cannot_read_corrections'; end if;

  -- Still no direct writes.
  begin
    update public.shift_handovers set net_amount = 1 where id = v_id;
    raise exception 'anon_wrote_handover';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.shift_handover_corrections_v1(handover_id, changes, previous, reason) values (v_id, '{}', '{}', 'x');
    raise exception 'anon_wrote_correction';
  exception when insufficient_privilege then null;
  end;
  begin
    perform count(*) from public.accountant_transactions;
    raise exception 'anon_read_transactions';
  exception when insufficient_privilege then null;
  end;

  -- No session, or a branch manager: refused inside the functions.
  perform set_config('test.actor', '', true);
  begin
    perform public.get_accountant_report_v1();
    raise exception 'no_session_read_report';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000002', true);
  begin
    perform public.get_accountant_report_v1();
    raise exception 'branch_manager_read_report';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

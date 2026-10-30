-- Only named counters count; managers keep planning and reviewing; top management edits the list.
do $$
declare
  v_session uuid;
  v_item uuid;
  v_items constant jsonb := '[{"product_code":"1001","item_name":"AUGMENTIN 1GM","expected_qty":"10"}]';
begin
  if (select count(*) from public.inventory_counters) <> 0 then raise exception 'production_seed_applied_to_fixture'; end if;
  insert into public.inventory_counters (staff_account_id, branch_scope) values
    ('00000000-0000-4000-8000-000000000003', 'shokry'),
    ('00000000-0000-4000-8000-000000000007', 'ALL'),
    ('00000000-0000-4000-8000-000000000008', 'elshamy');

  perform set_config('test.actor', '00000000-0000-4000-8000-000000000002', true);
  v_session := (public.create_inventory_weekly_count_v1('فرع شكري', '2026-11-01', '2026-11-05', v_items)->>'session_id')::uuid;
  select id into v_item from public.inventory_count_items where session_id = v_session;

  -- An assistant of the branch who is not a named counter cannot count.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000006', true);
  begin
    perform public.save_inventory_count_quantities_v1(v_session, jsonb_build_array(jsonb_build_object('item_id', v_item, 'actual_qty', '9')));
    raise exception 'unnamed_assistant_counted';
  exception when insufficient_privilege then null;
  end;
  -- A counter without login is refused; an all-branches counter counts Shokry.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000008', true);
  begin
    perform public.save_inventory_count_quantities_v1(v_session, jsonb_build_array(jsonb_build_object('item_id', v_item, 'actual_qty', '9')));
    raise exception 'no_login_counter_counted';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000007', true);
  if public.save_inventory_count_quantities_v1(v_session, jsonb_build_array(jsonb_build_object('item_id', v_item, 'actual_qty', '9'))) <> 1 then
    raise exception 'all_branches_counter_refused';
  end if;
  -- A counter cannot edit the list; the general manager can.
  begin
    perform public.set_inventory_counter_v1('00000000-0000-4000-8000-000000000006', 'shokry', true);
    raise exception 'counter_edited_list';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000001', true);
  perform public.set_inventory_counter_v1('00000000-0000-4000-8000-000000000006', 'shokry', true);
  if (select count(*) from public.list_inventory_counters_v1()) <> 4 then raise exception 'list_wrong'; end if;
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000005', true);
  if (select count(*) from public.list_inventory_counters_v1()) <> 0 then raise exception 'delivery_sees_list'; end if;
end;
$$;

-- Reads: the named counter sees the branch, an unnamed pharmacist-level assistant of another branch does not.
set role anon;
do $$
begin
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000003', true);
  if (select count(*) from public.inventory_count_sessions) <> 1 then raise exception 'counter_cannot_read'; end if;
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000004', true);
  if (select count(*) from public.inventory_count_sessions) <> 0 then raise exception 'unnamed_reads'; end if;
  begin
    perform 1 from public.inventory_counters;
    raise exception 'counters_table_readable';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

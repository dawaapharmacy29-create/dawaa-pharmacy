-- Weekly count lifecycle, branch scope and closed direct writes.
do $$
declare
  v jsonb;
  v_session uuid;
  v_item uuid;
  v_other uuid;
  v_n integer;
  v_items constant jsonb := '[{"product_code":"1001","item_name":"AUGMENTIN 1GM","expected_qty":"10","unit_price":"120"},
                              {"product_code":"1002","item_name":"PANADOL","expected_qty":"5"}]';
begin
  -- An assistant cannot plan; the delivery has no access; the Shokry manager cannot plan Al-Shami.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000003', true);
  begin
    perform public.create_inventory_weekly_count_v1('فرع شكري', '2026-11-01', '2026-11-05', v_items);
    raise exception 'assistant_planned';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000002', true);
  begin
    perform public.create_inventory_weekly_count_v1('فرع الشامي', '2026-11-01', '2026-11-05', v_items);
    raise exception 'manager_planned_other_branch';
  exception when insufficient_privilege then null;
  end;

  -- The branch manager plans the week from the Excel rows.
  v := public.create_inventory_weekly_count_v1('فرع شكري', '2026-11-01', '2026-11-05', v_items);
  v_session := (v->>'session_id')::uuid;
  if (v->>'items')::int <> 2 then raise exception 'items_not_created: %', v; end if;
  begin
    perform public.create_inventory_weekly_count_v1('فرع شكري', '2026-11-01', '2026-11-05', v_items);
    raise exception 'week_planned_twice';
  exception when raise_exception then
    if sqlerrm <> 'week_already_planned' then raise; end if;
  end;
  begin
    perform public.create_inventory_weekly_count_v1('فرع شكري', '2026-11-08', '2026-11-12', '[{"item_name":"X","expected_qty":"abc"}]');
    raise exception 'invalid_items_accepted';
  exception when raise_exception then
    if sqlerrm <> 'invalid_items' then raise; end if;
  end;

  select id into v_item from public.inventory_count_items where session_id = v_session and product_code = '1001';
  select id into v_other from public.inventory_count_items where session_id = v_session and product_code = '1002';

  -- The Al-Shami assistant cannot count Shokry; the Shokry assistant can.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000004', true);
  begin
    perform public.save_inventory_count_quantities_v1(v_session, jsonb_build_array(jsonb_build_object('item_id', v_item, 'actual_qty', '8')));
    raise exception 'other_branch_counted';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000003', true);
  v_n := public.save_inventory_count_quantities_v1(v_session, jsonb_build_array(jsonb_build_object('item_id', v_item, 'actual_qty', '8')));
  if v_n <> 1 then raise exception 'count_not_saved'; end if;
  if (select difference from public.inventory_count_items where id = v_item) <> -2 then raise exception 'difference_wrong'; end if;
  if (select status from public.inventory_count_sessions where id = v_session) <> 'counting' then raise exception 'status_not_counting'; end if;

  -- Submit needs every item counted.
  begin
    perform public.submit_inventory_count_v1(v_session);
    raise exception 'submitted_incomplete';
  exception when raise_exception then
    if sqlerrm not like 'items_not_counted:%' then raise; end if;
  end;
  perform public.save_inventory_count_quantities_v1(v_session, jsonb_build_array(jsonb_build_object('item_id', v_other, 'actual_qty', '5')));
  perform public.submit_inventory_count_v1(v_session);
  begin
    perform public.save_inventory_count_quantities_v1(v_session, jsonb_build_array(jsonb_build_object('item_id', v_item, 'actual_qty', '9')));
    raise exception 'edited_after_submit';
  exception when raise_exception then
    if sqlerrm <> 'session_not_open' then raise; end if;
  end;

  -- The assistant cannot approve; the manager approves with a reviewed quantity.
  begin
    perform public.review_inventory_count_v1(v_session, '[]', 'approve');
    raise exception 'assistant_approved';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000002', true);
  v := public.review_inventory_count_v1(v_session,
    jsonb_build_array(jsonb_build_object('item_id', v_item, 'review_result', 'corrected', 'reviewed_qty', '9', 'reason', 'شريط في الدرج')), 'approve');
  if v->>'status' <> 'closed' then raise exception 'not_closed: %', v; end if;
  if (select reviewed_qty from public.inventory_count_items where id = v_item) <> 9 then raise exception 'review_not_saved'; end if;
  if (select count(*) from public.inventory_count_events where session_id = v_session) <> 3 then raise exception 'events_missing'; end if;
end;
$$;

-- Direct writes are closed for the browser roles; reads follow the branch.
set role anon;
do $$
begin
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000003', true);
  if (select count(*) from public.inventory_count_sessions) <> 1 then raise exception 'own_branch_not_visible'; end if;
  if (select count(*) from public.inventory_count_items) <> 2 then raise exception 'own_items_not_visible'; end if;
  begin
    update public.inventory_count_items set actual_qty = 100;
    raise exception 'direct_update_allowed';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000004', true);
  if (select count(*) from public.inventory_count_sessions) <> 0 then raise exception 'other_branch_visible'; end if;
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000005', true);
  if (select count(*) from public.inventory_count_items) <> 0 then raise exception 'delivery_sees_items'; end if;
  perform set_config('test.actor', '', true);
  if (select count(*) from public.inventory_count_sessions) <> 0 then raise exception 'no_session_sees_rows'; end if;
end;
$$;
reset role;

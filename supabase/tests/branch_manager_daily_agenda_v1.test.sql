-- The agenda reads the branch's own data, keeps the branch scope and requires notes.
do $$
declare
  v jsonb;
  v_item jsonb;
begin
  -- An assistant and a manager of the other branch have no agenda here.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000003', true);
  begin
    perform public.get_branch_manager_agenda_v1('فرع شكري');
    raise exception 'assistant_read_agenda';
  exception when insufficient_privilege then null;
  end;
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000002', true);
  begin
    perform public.get_branch_manager_agenda_v1('فرع الشامي');
    raise exception 'manager_read_other_branch';
  exception when insufficient_privilege then null;
  end;

  -- The Shokry manager gets the own branch without naming it.
  v := public.get_branch_manager_agenda_v1(null);
  if v->>'branch' <> 'shokry' or (v->>'total')::int <> 9 then raise exception 'agenda_shape: %', v; end if;
  if (v->>'sales_day')::date <> current_date - 2 then raise exception 'sales_day_wrong: %', v->>'sales_day'; end if;

  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'open_requests';
  if (v_item->>'count')::int <> 2 then raise exception 'open_requests_wrong: %', v_item; end if;
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'uncoded_invoices';
  if (v_item->>'count')::int <> 2 or v_item->'rows'->0->>'seller' <> 'د أحمد' then raise exception 'uncoded_wrong: %', v_item; end if;
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'purchases_review';
  if (v_item->>'count')::int <> 1 or v_item->'rows'->0->>'invoice_number' <> 'P1' then raise exception 'purchases_wrong: %', v_item; end if;
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'weekly_inventory';
  if v_item->>'inventory_status' <> 'not_planned' or (v_item->>'done')::boolean then raise exception 'inventory_wrong: %', v_item; end if;
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'big_customers';
  if (v_item->>'count')::int <> 1 then raise exception 'big_wrong: %', v_item; end if;
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'high_discount';
  if (v_item->>'count')::int <> 1 or v_item->'rows'->0->>'invoice_number' <> 'S3' then raise exception 'discount_wrong: %', v_item; end if;
  if (v->>'done')::int <> 0 then raise exception 'done_wrong: %', v->>'done'; end if;

  -- Notes: a fine floor check needs none; a decision or an issue does.
  perform public.mark_branch_manager_agenda_item_v1(null, 'cash_reconciliation', 'done', null);
  begin
    perform public.mark_branch_manager_agenda_item_v1(null, 'high_discount', 'done', '  ');
    raise exception 'decision_without_note';
  exception when raise_exception then
    if sqlerrm <> 'note_required' then raise; end if;
  end;
  begin
    perform public.mark_branch_manager_agenda_item_v1(null, 'shelves_fridge', 'issue', null);
    raise exception 'issue_without_note';
  exception when raise_exception then
    if sqlerrm <> 'note_required' then raise; end if;
  end;
  perform public.mark_branch_manager_agenda_item_v1(null, 'high_discount', 'done', 'خصم كبار السن');
  v := public.get_branch_manager_agenda_v1(null);
  if (v->>'done')::int <> 2 then raise exception 'marks_not_counted: %', v->>'done'; end if;
  perform public.mark_branch_manager_agenda_item_v1(null, 'cash_reconciliation', 'clear');
  v := public.get_branch_manager_agenda_v1(null);
  if (v->>'done')::int <> 1 then raise exception 'clear_failed: %', v->>'done'; end if;

  -- Top management reads any branch by name.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000001', true);
  v := public.get_branch_manager_agenda_v1('فرع الشامي');
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'big_customers';
  if v->>'branch' <> 'elshamy' or (v_item->>'count')::int <> 1 then raise exception 'top_management_wrong: %', v; end if;
end;
$$;

-- The marks table is closed to the browser roles.
set role anon;
do $$
begin
  perform count(*) from public.branch_manager_agenda_marks;
  raise exception 'marks_readable';
exception when insufficient_privilege then null;
end;
$$;
reset role;

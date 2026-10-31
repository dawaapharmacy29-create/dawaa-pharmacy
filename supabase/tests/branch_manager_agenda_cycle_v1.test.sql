-- Cycle-scoped open requests and the cycle compliance read.
do $$
declare
  v jsonb;
  v_item jsonb;
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_cycle_start date;
  v_in_cycle integer;
  v_before integer;
  v_day jsonb;
begin
  v_cycle_start := case when extract(day from v_today) >= 26
    then make_date(extract(year from v_today)::int, extract(month from v_today)::int, 26)
    else (date_trunc('month', v_today) - interval '1 month')::date + 25 end;
  select count(*) filter (where created_at >= (v_cycle_start::timestamp at time zone 'Africa/Cairo')
                            and created_at < now() - interval '24 hours'),
         count(*) filter (where created_at < (v_cycle_start::timestamp at time zone 'Africa/Cairo'))
    into v_in_cycle, v_before
  from public.customer_requests
  where branch = 'فرع شكري' and status not in ('delivered', 'closed', 'cancelled', 'not_available');

  perform set_config('test.actor', '00000000-0000-4000-8000-000000000002', true);
  v := public.get_branch_manager_agenda_v1(null);
  if (v->>'cycle_start')::date <> v_cycle_start then raise exception 'cycle_start_wrong: %', v->>'cycle_start'; end if;
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'open_requests';
  if (v_item->>'count')::int <> v_in_cycle or (v_item->>'before_cycle')::int <> v_before or v_before < 1 then
    raise exception 'open_requests_cycle_wrong: % (in % before %)', v_item, v_in_cycle, v_before;
  end if;

  -- The manager sees the own branch's cycle days; a flagged check carries its note.
  perform public.mark_branch_manager_agenda_item_v1(null, 'cash_reconciliation', 'done', null);
  perform public.mark_branch_manager_agenda_item_v1(null, 'shelves_fridge', 'issue', 'التلاجة سخنة');
  v := public.get_branch_manager_agenda_compliance_v1(null);
  if jsonb_array_length(v->'days') <> v_today - v_cycle_start + 1 then raise exception 'days_wrong: %', v; end if;
  if exists (select 1 from jsonb_array_elements(v->'days') d where d->>'branch' <> 'shokry') then
    raise exception 'other_branch_leaked';
  end if;
  v_day := v->'days'->0;
  if (v_day->>'day')::date <> v_today or (v_day->>'checks_done')::int <> 2 or v_day->'issues'->0->>'note' <> 'التلاجة سخنة' then
    raise exception 'today_wrong: %', v_day;
  end if;
  begin
    perform public.get_branch_manager_agenda_compliance_v1('فرع الشامي');
    raise exception 'manager_read_other_branch';
  exception when insufficient_privilege then null;
  end;

  -- The general manager reads both branches; an assistant reads none.
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000001', true);
  v := public.get_branch_manager_agenda_compliance_v1(null);
  if jsonb_array_length(v->'days') <> 2 * (v_today - v_cycle_start + 1) then raise exception 'gm_days_wrong: %', v; end if;
  perform set_config('test.actor', '00000000-0000-4000-8000-000000000003', true);
  begin
    perform public.get_branch_manager_agenda_compliance_v1(null);
    raise exception 'assistant_read_compliance';
  exception when insufficient_privilege then null;
  end;
end;
$$;

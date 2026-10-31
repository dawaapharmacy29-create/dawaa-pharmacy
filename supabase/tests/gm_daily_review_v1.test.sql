-- The general manager's daily review: who can read it, what turns green, marks and app links.
do $$
declare
  v jsonb;
  v_item jsonb;
begin
  -- A branch manager or assistant has no access.
  foreach v_item in array array['"00000000-0000-4000-8000-000000000002"'::jsonb, '"00000000-0000-4000-8000-000000000003"'::jsonb] loop
    perform set_config('test.actor', v_item #>> '{}', true);
    begin
      perform public.get_gm_daily_review_v1();
      raise exception 'non_gm_read_review';
    exception when insufficient_privilege then null;
    end;
  end loop;

  perform set_config('test.actor', '00000000-0000-4000-8000-000000000001', true);
  v := public.get_gm_daily_review_v1();
  if (v->>'total')::int <> 8 then raise exception 'review_shape: %', v; end if;

  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'attendance';
  if (v_item->>'ok')::boolean or (v_item->'detail'->1->>'pending')::int <> 1 or (v_item->'detail'->1->>'late')::int <> 1 then
    raise exception 'attendance_wrong: %', v_item;
  end if;
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'cleaning';
  if (v_item->>'ok')::boolean or (v_item->'detail'->0->>'ratings')::int <> 0 or (v_item->'detail'->1->>'ratings')::int <> 1 then
    raise exception 'cleaning_wrong: %', v_item;  -- detail is ordered elshamy, shokry
  end if;
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'purchases_handover';
  if (v_item->>'done')::boolean or v_item->>'kind' <> 'external' or v_item->'detail'->>'last_handover' <> '2026-09-11' then
    raise exception 'purchases_wrong: %', v_item;
  end if;

  -- An issue needs a note; a done mark closes an external item; clear reopens it.
  begin
    perform public.mark_gm_daily_review_item_v1('delivery', 'issue', ' ');
    raise exception 'issue_without_note';
  exception when raise_exception then if sqlerrm <> 'note_required' then raise; end if;
  end;
  perform public.mark_gm_daily_review_item_v1('delivery', 'done');
  perform public.mark_gm_daily_review_item_v1('attendance', 'issue', 'فيه بصمة ناقصة في شكري');
  v := public.get_gm_daily_review_v1();
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'delivery';
  if not (v_item->>'done')::boolean or v_item->>'marked_by' <> 'مدير عام' then raise exception 'mark_not_applied: %', v_item; end if;
  if (v->'history'->0->>'marked')::int <> 2 then raise exception 'history_wrong: %', v->'history'->0; end if;
  perform public.mark_gm_daily_review_item_v1('delivery', 'clear');
  v := public.get_gm_daily_review_v1();
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'delivery';
  if (v_item->>'done')::boolean then raise exception 'clear_failed'; end if;

  -- App links: https only; empty removes.
  begin
    perform public.set_gm_daily_review_link_v1('delivery', 'javascript:alert(1)');
    raise exception 'bad_url_saved';
  exception when raise_exception then if sqlerrm <> 'invalid_url' then raise; end if;
  end;
  perform public.set_gm_daily_review_link_v1('delivery', 'https://delivery.example.app');
  v := public.get_gm_daily_review_v1();
  select i into v_item from jsonb_array_elements(v->'items') i where i->>'key' = 'delivery';
  if v_item->>'url' <> 'https://delivery.example.app' then raise exception 'link_not_saved: %', v_item; end if;
  perform public.set_gm_daily_review_link_v1('delivery', '');
  if exists (select 1 from public.gm_daily_review_links) then raise exception 'link_not_removed'; end if;

  perform set_config('test.actor', '00000000-0000-4000-8000-000000000002', true);
  begin
    perform public.mark_gm_daily_review_item_v1('delivery', 'done');
    raise exception 'non_gm_marked';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- The tables stay closed to the browser roles.
set role anon;
do $$
begin
  perform count(*) from public.gm_daily_review_marks;
  raise exception 'marks_readable';
exception when insufficient_privilege then null;
end;
$$;
reset role;

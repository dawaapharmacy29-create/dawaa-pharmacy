-- «تنزيل الاستوريز» in the daily lists.
-- Branch manager «قائمة اليوم»: a fourth floor check `stories_upload` (one tap «تمام», a note only for «فيه مشكلة»).
-- General manager «مراجعتي اليومية»: item `stories`, green on its own once both branches marked today's stories
-- as done; the general manager can also mark it «راجعت» by hand.
-- The functions are patched from their live definitions; each replacement must match exactly once.

do $migration$
declare
  v_def text;
  v_old text;
  v_new text;
begin
  -- Each step replaces v_old by v_new in v_def and fails when v_old is not found exactly once.

  ---------------------------------------------------------------------------------------------------
  -- 1) get_branch_manager_agenda_v1: add the floor check after shelves_fridge.
  v_def := pg_get_functiondef('public.get_branch_manager_agenda_v1(text)'::regprocedure);
  v_old := $$|| jsonb_build_object('key', 'shelves_fridge', 'group', 'check', 'count', 1, 'rows', '[]'::jsonb);$$;
  v_new := $$|| jsonb_build_object('key', 'shelves_fridge', 'group', 'check', 'count', 1, 'rows', '[]'::jsonb)
    || jsonb_build_object('key', 'stories_upload', 'group', 'check', 'count', 1, 'rows', '[]'::jsonb);$$;
  if array_length(string_to_array(v_def, v_old), 1) <> 2 then
    raise exception 'get_branch_manager_agenda_v1: anchor not found once';
  end if;
  execute replace(v_def, v_old, v_new);

  ---------------------------------------------------------------------------------------------------
  -- 2) mark_branch_manager_agenda_item_v1: accept the key; «تمام» needs no note like the other floor checks.
  v_def := pg_get_functiondef('public.mark_branch_manager_agenda_item_v1(text,text,text,text)'::regprocedure);
  v_old := $$'big_customers', 'high_discount', 'cash_reconciliation', 'appearance_cleanliness',
                        'shelves_fridge') then$$;
  v_new := $$'big_customers', 'high_discount', 'cash_reconciliation', 'appearance_cleanliness',
                        'shelves_fridge', 'stories_upload') then$$;
  if array_length(string_to_array(v_def, v_old), 1) <> 2 then
    raise exception 'mark_branch_manager_agenda_item_v1: item list not found once';
  end if;
  v_def := replace(v_def, v_old, v_new);
  v_old := $$and p_item_key in ('cash_reconciliation', 'appearance_cleanliness', 'shelves_fridge')) then$$;
  v_new := $$and p_item_key in ('cash_reconciliation', 'appearance_cleanliness', 'shelves_fridge', 'stories_upload')) then$$;
  if array_length(string_to_array(v_def, v_old), 1) <> 2 then
    raise exception 'mark_branch_manager_agenda_item_v1: note rule not found once';
  end if;
  execute replace(v_def, v_old, v_new);

  ---------------------------------------------------------------------------------------------------
  -- 3) get_branch_manager_agenda_compliance_v1: the floor round is now 4 checks.
  v_def := pg_get_functiondef('public.get_branch_manager_agenda_compliance_v1(text)'::regprocedure);
  v_old := $$'checks_total', 3,$$;
  v_new := $$'checks_total', 4,$$;
  if array_length(string_to_array(v_def, v_old), 1) <> 2 then
    raise exception 'get_branch_manager_agenda_compliance_v1: checks_total not found once';
  end if;
  v_def := replace(v_def, v_old, v_new);
  v_old := $$mk.item_key in ('cash_reconciliation', 'appearance_cleanliness', 'shelves_fridge')$$;
  v_new := $$mk.item_key in ('cash_reconciliation', 'appearance_cleanliness', 'shelves_fridge', 'stories_upload')$$;
  if array_length(string_to_array(v_def, v_old), 1) <> 2 then
    raise exception 'get_branch_manager_agenda_compliance_v1: check list not found once';
  end if;
  execute replace(v_def, v_old, v_new);

  ---------------------------------------------------------------------------------------------------
  -- 4) get_gm_daily_review_v1: managers count 4 checks; new `stories` item before `customers`.
  v_def := pg_get_functiondef('public.get_gm_daily_review_v1()'::regprocedure);
  v_old := $$'checks_done', coalesce(x.checks, 0), 'checks_total', 3,$$;
  v_new := $$'checks_done', coalesce(x.checks, 0), 'checks_total', 4,$$;
  if array_length(string_to_array(v_def, v_old), 1) <> 2 then
    raise exception 'get_gm_daily_review_v1: managers total not found once';
  end if;
  v_def := replace(v_def, v_old, v_new);
  v_old := $$bool_and(coalesce(x.checks, 0) >= 3)$$;
  v_new := $$bool_and(coalesce(x.checks, 0) >= 4)$$;
  if array_length(string_to_array(v_def, v_old), 1) <> 2 then
    raise exception 'get_gm_daily_review_v1: managers rule not found once';
  end if;
  v_def := replace(v_def, v_old, v_new);
  v_old := $$select count(*) filter (where m.item_key in ('cash_reconciliation', 'appearance_cleanliness', 'shelves_fridge')) checks,$$;
  v_new := $$select count(*) filter (where m.item_key in ('cash_reconciliation', 'appearance_cleanliness', 'shelves_fridge', 'stories_upload')) checks,$$;
  if array_length(string_to_array(v_def, v_old), 1) <> 2 then
    raise exception 'get_gm_daily_review_v1: managers checks not found once';
  end if;
  v_def := replace(v_def, v_old, v_new);
  v_old := $$  select count(*) into v_n from public.customer_requests cr$$;
  v_new := $$  -- Stories: each branch manager marks today's stories in «قائمة اليوم».
  select jsonb_agg(jsonb_build_object('branch', b.k, 'state', m.state, 'note', m.note, 'marked_at', m.marked_at,
           'marked_by', sa.name) order by b.k),
         bool_and(coalesce(m.state = 'done', false))
    into v_detail, v_ok
  from (values ('shokry'), ('elshamy')) b(k)
  left join public.branch_manager_agenda_marks m
    on m.branch_key = b.k and m.agenda_day = v_today and m.item_key = 'stories_upload'
  left join public.staff_accounts sa on sa.id = m.staff_account_id;
  v_items := v_items || jsonb_build_object('key', 'stories', 'kind', 'auto', 'ok', coalesce(v_ok, false),
    'detail', v_detail, 'data_day', v_today);

  select count(*) into v_n from public.customer_requests cr$$;
  if array_length(string_to_array(v_def, v_old), 1) <> 2 then
    raise exception 'get_gm_daily_review_v1: customers anchor not found once';
  end if;
  execute replace(v_def, v_old, v_new);

  ---------------------------------------------------------------------------------------------------
  -- 5) mark_gm_daily_review_item_v1 + its table check: accept `stories`.
  v_def := pg_get_functiondef('public.mark_gm_daily_review_item_v1(text,text,text)'::regprocedure);
  v_old := $$'purchases_handover', 'shifts', 'delivery', 'collection_transfers', 'customers') then$$;
  v_new := $$'purchases_handover', 'shifts', 'delivery', 'collection_transfers', 'customers', 'stories') then$$;
  if array_length(string_to_array(v_def, v_old), 1) <> 2 then
    raise exception 'mark_gm_daily_review_item_v1: item list not found once';
  end if;
  execute replace(v_def, v_old, v_new);
end
$migration$;

alter table public.gm_daily_review_marks drop constraint if exists gm_daily_review_marks_item_key_check;
alter table public.gm_daily_review_marks add constraint gm_daily_review_marks_item_key_check
  check (item_key = any (array['sales_upload', 'attendance', 'managers', 'cleaning', 'inventory',
    'purchases_handover', 'shifts', 'delivery', 'collection_transfers', 'customers', 'stories']));

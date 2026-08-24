-- Save the branch inspection, staff reviews and ledger effects atomically.

create unique index if not exists uq_employee_transactions_branch_visit_staff_v1
  on public.employee_transactions(source, source_id, staff_id)
  where source = 'branch_visit';

create or replace function public.save_branch_inspection_v1(p_payload jsonb)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_actor_id uuid;
  v_actor_name text;
  v_report_id uuid;
  v_branch text := nullif(btrim(p_payload->>'branch'), '');
  v_staff_evals jsonb := coalesce(p_payload->'staff_evals', '[]'::jsonb);
  v_eval jsonb;
  v_staff_id uuid;
  v_delta numeric;
begin
  v_actor_id := public.dawaa_current_staff_account_id_strict();
  if v_actor_id is null or not public.dawaa_can_branch_inspection(true) then
    raise exception 'not authorized to save branch inspection';
  end if;
  if v_branch is null then raise exception 'branch is required'; end if;
  if jsonb_typeof(v_staff_evals) <> 'array' then raise exception 'staff_evals must be an array'; end if;

  select coalesce(sa.staff_name, sa.name, sa.username, sa.id::text)
    into v_actor_name
  from public.staff_accounts sa
  where sa.id = v_actor_id;

  insert into public.branch_inspections(
    branch, date, time, inspector_name, inspector_id, sections, staff_evals,
    action_items, overall_notes, overall_score, next_visit_date, created_at
  ) values (
    v_branch,
    coalesce(nullif(p_payload->>'date', '')::date, current_date),
    nullif(p_payload->>'time', ''),
    coalesce(nullif(btrim(p_payload->>'inspector_name'), ''), v_actor_name),
    v_actor_id,
    coalesce(p_payload->'sections', '[]'::jsonb),
    v_staff_evals,
    coalesce(p_payload->'action_items', '[]'::jsonb),
    nullif(btrim(p_payload->>'overall_notes'), ''),
    coalesce(nullif(p_payload->>'overall_score', '')::numeric, 0),
    nullif(p_payload->>'next_visit_date', '')::date,
    now()
  ) returning id into v_report_id;

  for v_eval in select value from jsonb_array_elements(v_staff_evals) loop
    v_staff_id := case
      when coalesce(v_eval->>'staff_id', '') ~
        '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      then (v_eval->>'staff_id')::uuid else null end;
    v_delta := coalesce(nullif(v_eval->>'points_delta', '')::numeric, 0);

    insert into public.branch_visit_staff_reviews(
      report_id, staff_id, staff_name, role, branch, shift_start, shift_end,
      rating, note, action_type, points_delta, money_amount, created_by_name
    ) values (
      v_report_id, v_staff_id, nullif(btrim(v_eval->>'name'), ''),
      nullif(btrim(v_eval->>'role'), ''),
      coalesce(nullif(btrim(v_eval->>'branch'), ''), v_branch),
      nullif(v_eval->>'shift_start', '')::time,
      nullif(v_eval->>'shift_end', '')::time,
      nullif(btrim(v_eval->>'rating'), ''), nullif(btrim(v_eval->>'note'), ''),
      coalesce(nullif(v_eval->>'action_type', ''), 'none'), v_delta,
      coalesce(nullif(v_eval->>'money_amount', '')::numeric, 0), v_actor_name
    );

    if v_staff_id is not null and v_delta <> 0 then
      insert into public.employee_transactions(
        staff_id, employee_name, branch, type, points, points_delta, amount,
        reason, description, source, source_id, month_cycle, status,
        created_by, created_by_name, approved_by, approved_by_name, approved_at,
        metadata
      ) values (
        v_staff_id, nullif(btrim(v_eval->>'name'), ''),
        coalesce(nullif(btrim(v_eval->>'branch'), ''), v_branch),
        case when v_delta > 0 then 'reward' else 'penalty' end,
        abs(v_delta), v_delta, 0,
        'مرور مدير الفروع',
        coalesce(nullif(btrim(v_eval->>'note'), ''),
                 nullif(btrim(p_payload->>'overall_notes'), ''),
                 'تقييم مرور مدير الفروع'),
        'branch_visit', v_report_id, public.dawaa_current_points_cycle_label_v1(),
        'active', v_actor_id::text, v_actor_name, v_actor_id::text,
        v_actor_name, now(),
        jsonb_build_object('branch_inspection_id', v_report_id,
                           'action_type', coalesce(v_eval->>'action_type', 'none'))
      );
    end if;
  end loop;

  return v_report_id;
end;
$$;

revoke all on function public.save_branch_inspection_v1(jsonb) from public;
grant execute on function public.save_branch_inspection_v1(jsonb) to anon, authenticated;

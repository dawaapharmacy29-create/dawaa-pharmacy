create or replace function public.project_branch_inspection_actions_to_tasks_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_action jsonb;
  v_eval jsonb;
  v_assigned_name text;
  v_staff_id uuid;
  v_staff_name text;
  v_task_id text;
  v_action_id text;
  v_task_priority text;
  v_notification_priority text;
  v_due_date text;
begin
  if jsonb_typeof(coalesce(new.action_items, '[]'::jsonb)) <> 'array' then
    return new;
  end if;

  for v_action in
    select value from jsonb_array_elements(coalesce(new.action_items, '[]'::jsonb))
  loop
    if nullif(btrim(v_action->>'text'), '') is null then
      continue;
    end if;

    v_assigned_name := nullif(btrim(v_action->>'assigned_to'), '');
    if v_assigned_name is null then
      continue;
    end if;

    v_staff_id := null;
    v_staff_name := null;

    for v_eval in
      select value from jsonb_array_elements(coalesce(new.staff_evals, '[]'::jsonb))
    loop
      if coalesce(v_eval->>'staff_id', '') ~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         and (
           lower(regexp_replace(btrim(coalesce(v_eval->>'name', '')), '\s+', ' ', 'g')) =
             lower(regexp_replace(v_assigned_name, '\s+', ' ', 'g'))
           or btrim(v_eval->>'staff_id') = v_assigned_name
         )
      then
        v_staff_id := (v_eval->>'staff_id')::uuid;
        v_staff_name := coalesce(nullif(btrim(v_eval->>'name'), ''), v_assigned_name);
        exit;
      end if;
    end loop;

    if v_staff_id is null then
      continue;
    end if;

    v_action_id := coalesce(
      nullif(btrim(v_action->>'id'), ''),
      md5(coalesce(v_action->>'text', '') || '|' || v_staff_id::text || '|' || new.id::text)
    );
    v_task_id := 'branch_inspection:' || new.id::text || ':' || v_action_id;

    v_task_priority := case coalesce(v_action->>'priority', '')
      when 'عاجل' then 'خطر'
      when 'منخفض' then 'منخفض'
      else 'عادي'
    end;
    v_notification_priority := case coalesce(v_action->>'priority', '')
      when 'عاجل' then 'urgent'
      when 'منخفض' then 'normal'
      else 'normal'
    end;
    v_due_date := case when new.next_visit_date is not null then new.next_visit_date::text else null end;

    insert into public.tasks(
      id, title, description, assigned_to, assigned_name, branch,
      status, priority, due_date, added_by, created_at,
      staff_id, target_type, target_id
    ) values (
      v_task_id,
      btrim(v_action->>'text'),
      'تكليف ناتج من مرور مدير الفروع — تقرير ' || new.id::text,
      v_staff_id::text,
      v_staff_name,
      new.branch,
      'open',
      v_task_priority,
      v_due_date,
      new.inspector_id::text,
      coalesce(new.created_at, now()),
      v_staff_id,
      'staff',
      v_staff_id::text
    ) on conflict (id) do nothing;

    insert into public.notifications(
      title, body, message, type, priority, status,
      recipient_staff_id, staff_id, branch,
      target_type, target_id, target_route, route,
      requires_action, created_by, created_by_name,
      metadata, dedupe_key, is_global, read, is_read, created_at
    ) values (
      'تكليف جديد من مرور مدير الفروع',
      btrim(v_action->>'text'),
      btrim(v_action->>'text'),
      'task',
      v_notification_priority,
      'new',
      v_staff_id::text,
      v_staff_id::text,
      new.branch,
      'task',
      v_task_id,
      '/operations-center',
      '/operations-center',
      true,
      new.inspector_id::text,
      new.inspector_name,
      jsonb_build_object(
        'branch_inspection_id', new.id,
        'branch_inspection_action_id', v_action_id,
        'task_id', v_task_id,
        'assigned_name', v_staff_name,
        'due_date', v_due_date,
        'source', 'branch_inspection'
      ),
      'branch_inspection_task:' || v_task_id,
      false,
      false,
      false,
      coalesce(new.created_at, now())
    ) on conflict (dedupe_key) where dedupe_key is not null do nothing;
  end loop;

  return new;
end;
$$;

revoke all on function public.project_branch_inspection_actions_to_tasks_v1() from public, anon, authenticated;

drop trigger if exists trg_project_branch_inspection_actions_to_tasks_v1 on public.branch_inspections;
create trigger trg_project_branch_inspection_actions_to_tasks_v1
after insert on public.branch_inspections
for each row
execute function public.project_branch_inspection_actions_to_tasks_v1();

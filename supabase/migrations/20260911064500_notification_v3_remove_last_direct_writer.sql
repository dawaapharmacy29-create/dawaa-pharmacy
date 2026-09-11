-- Remove the final database producer that wrote directly to notifications.
-- Branch inspection tasks continue to be created normally, while their notification
-- is emitted through the canonical system producer boundary.

create or replace function public.project_branch_inspection_actions_to_tasks_v1()
returns trigger
language plpgsql
security definer
set search_path=public,pg_catalog
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
  if jsonb_typeof(coalesce(new.action_items, '[]'::jsonb)) <> 'array' then return new; end if;

  for v_action in select value from jsonb_array_elements(coalesce(new.action_items, '[]'::jsonb)) loop
    if nullif(btrim(v_action->>'text'), '') is null then continue; end if;
    v_assigned_name := nullif(btrim(v_action->>'assigned_to'), '');
    if v_assigned_name is null then continue; end if;

    v_staff_id := null;
    v_staff_name := null;
    for v_eval in select value from jsonb_array_elements(coalesce(new.staff_evals, '[]'::jsonb)) loop
      if coalesce(v_eval->>'staff_id', '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
         and (
           lower(regexp_replace(btrim(coalesce(v_eval->>'name', '')), '\s+', ' ', 'g')) = lower(regexp_replace(v_assigned_name, '\s+', ' ', 'g'))
           or btrim(v_eval->>'staff_id') = v_assigned_name
         ) then
        v_staff_id := (v_eval->>'staff_id')::uuid;
        v_staff_name := coalesce(nullif(btrim(v_eval->>'name'), ''), v_assigned_name);
        exit;
      end if;
    end loop;
    if v_staff_id is null then continue; end if;

    v_action_id := coalesce(nullif(btrim(v_action->>'id'), ''), md5(coalesce(v_action->>'text', '') || '|' || v_staff_id::text || '|' || new.id::text));
    v_task_id := 'branch_inspection:' || new.id::text || ':' || v_action_id;
    v_task_priority := case coalesce(v_action->>'priority', '') when 'عاجل' then 'خطر' when 'منخفض' then 'منخفض' else 'عادي' end;
    v_notification_priority := case coalesce(v_action->>'priority', '') when 'عاجل' then 'urgent' else 'normal' end;
    v_due_date := case when new.next_visit_date is not null then new.next_visit_date::text else null end;

    insert into public.tasks(
      id,title,description,assigned_to,assigned_name,branch,status,priority,due_date,added_by,created_at,staff_id,target_type,target_id
    ) values (
      v_task_id,btrim(v_action->>'text'),'تكليف ناتج من مرور مدير الفروع — تقرير ' || new.id::text,
      v_staff_id::text,v_staff_name,new.branch,'open',v_task_priority,v_due_date,new.inspector_id::text,
      coalesce(new.created_at,now()),v_staff_id,'staff',v_staff_id::text
    ) on conflict(id) do nothing;

    perform public.emit_system_notification_v2(
      p_recipient_staff_id => v_staff_id::text,
      p_branch => new.branch,
      p_notification_type => 'staff_task',
      p_title => 'تكليف جديد من مرور مدير الفروع',
      p_message => btrim(v_action->>'text'),
      p_entity_type => 'staff_task',
      p_entity_id => v_task_id,
      p_action_url => '/operations-center?taskId=' || v_task_id,
      p_priority => v_notification_priority,
      p_metadata => jsonb_build_object(
        'branch_inspection_id',new.id,
        'branch_inspection_action_id',v_action_id,
        'task_id',v_task_id,
        'assigned_name',v_staff_name,
        'due_date',v_due_date,
        'source','branch_inspection',
        'requiresAction',true
      ),
      p_dedupe_key => 'branch_inspection_task:' || v_task_id,
      p_requires_action => true,
      p_sound_enabled => v_notification_priority='urgent'
    );
  end loop;
  return new;
end;
$$;

notify pgrst,'reload schema';

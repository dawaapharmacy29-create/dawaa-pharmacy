-- إشعارات تشغيلية للمهام المنفذة والمتأخرة.
-- المستلم الأساسي هو الموظف المسند إليه، ومدير الفرع/الإدارة العامة يرونها حسب نطاقهم.

create or replace function public.dawaa_task_status_completed_v1(p_status text)
returns boolean
language sql
immutable
as $$
  select lower(trim(coalesce(p_status,''))) in ('completed','complete','done','finished','تم','مكتمل','منتهي','منفذ');
$$;

create or replace function public.dawaa_insert_task_notification_v1(
  p_task_id text,
  p_recipient_staff_id text,
  p_branch text,
  p_title text,
  p_message text,
  p_route text,
  p_priority text,
  p_state text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_id uuid;
  v_key text;
begin
  if nullif(trim(p_task_id),'') is null then return null; end if;
  v_key := format('staff-task:%s:%s', lower(trim(p_task_id)), lower(trim(coalesce(p_state,'current'))));

  insert into public.notifications(
    recipient_staff_id, notification_type, type, title, message, body,
    entity_type, entity_id, target_type, target_id,
    action_url, target_route, route, priority, metadata, dedupe_key,
    is_global, is_read, read, status, branch, created_at
  ) values (
    nullif(trim(p_recipient_staff_id),''), 'staff_task', 'staff_task',
    coalesce(nullif(trim(p_title),''),'إشعار مهمة'),
    coalesce(p_message,''), coalesce(p_message,''),
    'staff_task', p_task_id, 'staff_task', p_task_id,
    nullif(trim(p_route),''), nullif(trim(p_route),''), nullif(trim(p_route),''),
    case when p_priority in ('low','normal','high','urgent','critical') then p_priority else 'normal' end,
    coalesce(p_metadata,'{}'::jsonb) || jsonb_build_object('taskState',p_state,'route',nullif(trim(p_route),'')),
    v_key, false, false, false, 'new', nullif(trim(p_branch),''), now()
  )
  on conflict(dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.dawaa_notify_employee_daily_task_change_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if public.dawaa_task_status_completed_v1(new.status)
     and (tg_op = 'INSERT' or not public.dawaa_task_status_completed_v1(old.status)) then
    perform public.dawaa_insert_task_notification_v1(
      new.id::text,
      new.staff_id,
      new.branch,
      'تمت المهمة: ' || coalesce(new.task_title,'مهمة يومية'),
      format(
        'تم تنفيذ المهمة بواسطة %s%s%s.',
        coalesce(nullif(new.completed_by_name,''), nullif(new.staff_name,''), 'الموظف'),
        case when new.completed_at is not null then ' — وقت التنفيذ: ' || to_char(new.completed_at at time zone 'Africa/Cairo','DD/MM/YYYY HH24:MI') else '' end,
        case when nullif(trim(new.notes),'') is not null then ' — ملاحظة: ' || new.notes else '' end
      ),
      coalesce(nullif(new.related_route,''), '/employee-operating-system?taskId=' || new.id::text),
      'normal',
      'completed',
      jsonb_build_object(
        'taskTitle',new.task_title,'taskDate',new.task_date,'staffName',new.staff_name,
        'completedByName',new.completed_by_name,'completedAt',new.completed_at,
        'source','employee_daily_tasks'
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dawaa_employee_task_notification_v1 on public.employee_daily_tasks;
create trigger trg_dawaa_employee_task_notification_v1
after insert or update of status, completed_at on public.employee_daily_tasks
for each row execute function public.dawaa_notify_employee_daily_task_change_v1();

create or replace function public.dawaa_notify_branch_daily_task_change_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  if public.dawaa_task_status_completed_v1(new.status)
     and (tg_op = 'INSERT' or not public.dawaa_task_status_completed_v1(old.status)) then
    perform public.dawaa_insert_task_notification_v1(
      new.id::text,
      new.assigned_staff_id::text,
      new.branch,
      'تمت مهمة الفرع: ' || coalesce(new.title,'مهمة يومية'),
      format(
        'تم تنفيذ المهمة%s%s%s.',
        case when nullif(trim(new.assigned_staff_name),'') is not null then ' بواسطة ' || new.assigned_staff_name else '' end,
        case when new.completed_at is not null then ' — وقت التنفيذ: ' || to_char(new.completed_at at time zone 'Africa/Cairo','DD/MM/YYYY HH24:MI') else '' end,
        case when nullif(trim(new.completion_note),'') is not null then ' — ملاحظة: ' || new.completion_note else '' end
      ),
      '/daily-command?taskId=' || new.id::text,
      'normal',
      'completed',
      jsonb_build_object(
        'taskTitle',new.title,'taskDate',new.task_date,'staffName',new.assigned_staff_name,
        'completedAt',new.completed_at,'approvedAt',new.approved_at,'source','branch_daily_tasks'
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_dawaa_branch_task_notification_v1 on public.branch_daily_tasks;
create trigger trg_dawaa_branch_task_notification_v1
after insert or update of status, completed_at on public.branch_daily_tasks
for each row execute function public.dawaa_notify_branch_daily_task_change_v1();

create or replace function public.dawaa_notify_overdue_tasks_v1()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r record;
  v_count integer := 0;
begin
  -- مهام الموظفين اليومية: تصبح متأخرة بعد انتهاء تاريخها.
  for r in
    select * from public.employee_daily_tasks
    where task_date >= current_date - 7
      and task_date < current_date
      and not public.dawaa_task_status_completed_v1(status)
  loop
    if public.dawaa_insert_task_notification_v1(
      r.id::text, r.staff_id, r.branch,
      'مهمة متأخرة: ' || coalesce(r.task_title,'مهمة يومية'),
      format('المهمة الخاصة بـ %s بتاريخ %s لم تُسجل كمكتملة حتى الآن.', coalesce(nullif(r.staff_name,''),'الموظف'), to_char(r.task_date,'DD/MM/YYYY')),
      coalesce(nullif(r.related_route,''), '/employee-operating-system?taskId=' || r.id::text),
      'high','overdue',
      jsonb_build_object('taskTitle',r.task_title,'taskDate',r.task_date,'staffName',r.staff_name,'source','employee_daily_tasks','requiresFollowup',true)
    ) is not null then v_count := v_count + 1; end if;
  end loop;

  -- مهام الفرع ذات وقت استحقاق واضح.
  for r in
    select * from public.branch_daily_tasks
    where task_date >= current_date - 7
      and due_at is not null and due_at < now()
      and not public.dawaa_task_status_completed_v1(status)
  loop
    if public.dawaa_insert_task_notification_v1(
      r.id::text, r.assigned_staff_id::text, r.branch,
      'مهمة فرع متأخرة: ' || coalesce(r.title,'مهمة يومية'),
      format('المهمة المسندة إلى %s تجاوزت موعدها %s ولم تُسجل كمكتملة.', coalesce(nullif(r.assigned_staff_name,''),'الموظف المسؤول'), to_char(r.due_at at time zone 'Africa/Cairo','DD/MM/YYYY HH24:MI')),
      '/daily-command?taskId=' || r.id::text,
      case when r.priority in ('urgent','critical') then 'urgent' else 'high' end,
      'overdue',
      jsonb_build_object('taskTitle',r.title,'taskDate',r.task_date,'staffName',r.assigned_staff_name,'dueAt',r.due_at,'source','branch_daily_tasks','requiresFollowup',true)
    ) is not null then v_count := v_count + 1; end if;
  end loop;

  return v_count;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname='dawaa-overdue-task-notifications-v1';
    perform cron.schedule(
      'dawaa-overdue-task-notifications-v1',
      '*/15 * * * *',
      'select public.dawaa_notify_overdue_tasks_v1();'
    );
  end if;
exception when others then
  raise notice 'Could not schedule overdue task notifications: %', sqlerrm;
end $$;

-- تغطية جدول tasks المستخدم داخل مركز المهام والتنبيهات نفسه.
-- الهدف: أي مهمة تُغلق من المركز تُنشئ إشعار "تمت المهمة"، وأي مهمة تتجاوز due_date تُنشئ إشعار تأخير مرة واحدة فقط.

create or replace function public.dawaa_notify_operations_task_change_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_recipient text;
  v_branch text;
begin
  v_recipient := coalesce(nullif(trim(new.staff_id::text),''), nullif(trim(new.assigned_to),''));
  v_branch := nullif(trim(new.branch),'');

  if public.dawaa_task_status_completed_v1(new.status)
     and (tg_op = 'INSERT' or not public.dawaa_task_status_completed_v1(old.status)) then
    perform public.dawaa_insert_task_notification_v1(
      new.id::text,
      v_recipient,
      v_branch,
      'تمت المهمة: ' || coalesce(nullif(trim(new.title),''),'مهمة تشغيلية'),
      format(
        'تم تسجيل تنفيذ المهمة%s — وقت التنفيذ: %s.',
        case when nullif(trim(new.assigned_name),'') is not null then ' بواسطة ' || new.assigned_name else '' end,
        to_char(now() at time zone 'Africa/Cairo','DD/MM/YYYY HH24:MI')
      ),
      '/operations-center?taskId=' || new.id::text,
      'normal',
      'completed',
      jsonb_build_object(
        'taskTitle',new.title,
        'staffName',new.assigned_name,
        'dueDate',new.due_date,
        'source','tasks',
        'completedAt',now()
      )
    );
  end if;

  return new;
end;
$$;

drop trigger if exists trg_dawaa_operations_task_notification_v1 on public.tasks;
create trigger trg_dawaa_operations_task_notification_v1
after insert or update of status on public.tasks
for each row execute function public.dawaa_notify_operations_task_change_v1();

create or replace function public.dawaa_notify_overdue_operations_tasks_v1()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r record;
  v_count integer := 0;
  v_due date;
  v_recipient text;
begin
  for r in
    select *
    from public.tasks
    where not public.dawaa_task_status_completed_v1(status)
      and nullif(trim(due_date),'') is not null
      and due_date ~ '^\\d{4}-\\d{2}-\\d{2}$'
      and due_date::date < current_date
      and created_at >= now() - interval '30 days'
  loop
    v_due := r.due_date::date;
    v_recipient := coalesce(nullif(trim(r.staff_id::text),''), nullif(trim(r.assigned_to),''));

    if public.dawaa_insert_task_notification_v1(
      r.id::text,
      v_recipient,
      r.branch,
      'مهمة متأخرة: ' || coalesce(nullif(trim(r.title),''),'مهمة تشغيلية'),
      format(
        'المهمة%s كان موعدها %s ولم تُسجل كمكتملة حتى الآن.',
        case when nullif(trim(r.assigned_name),'') is not null then ' المسندة إلى ' || r.assigned_name else '' end,
        to_char(v_due,'DD/MM/YYYY')
      ),
      '/operations-center?taskId=' || r.id::text,
      case when lower(trim(coalesce(r.priority,''))) in ('urgent','critical','خطر') then 'urgent' else 'high' end,
      'overdue',
      jsonb_build_object(
        'taskTitle',r.title,
        'staffName',r.assigned_name,
        'dueDate',r.due_date,
        'source','tasks',
        'requiresFollowup',true
      )
    ) is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname='dawaa-overdue-operations-tasks-v1';
    perform cron.schedule(
      'dawaa-overdue-operations-tasks-v1',
      '*/15 * * * *',
      'select public.dawaa_notify_overdue_operations_tasks_v1();'
    );
  end if;
exception when others then
  raise notice 'Could not schedule operations task overdue notifications: %', sqlerrm;
end $$;

alter table public.employee_daily_tasks
  add column if not exists due_at timestamptz;

create or replace function public.set_employee_daily_task_due_at_v1()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_start time;
  v_end time;
  v_due_local timestamp;
begin
  if new.due_at is not null or new.task_date is null or coalesce(new.staff_id,'') = '' then
    return new;
  end if;

  select coalesce(s.shift_start, s.default_shift_start),
         coalesce(s.shift_end, s.default_shift_end)
    into v_start, v_end
  from public.staff s
  where s.id::text = new.staff_id
  limit 1;

  if new.task_key in ('rider.clock_in','open_daily_workspace') and v_start is not null then
    v_due_local := new.task_date::timestamp + v_start + interval '30 minutes';
  elsif v_end is not null then
    v_due_local := new.task_date::timestamp + v_end;
    if v_start is not null and v_end <= v_start then
      v_due_local := v_due_local + interval '1 day';
    end if;
    v_due_local := v_due_local - interval '1 hour';
  else
    return new;
  end if;

  new.due_at := v_due_local at time zone 'Africa/Cairo';
  return new;
end;
$$;

drop trigger if exists trg_set_employee_daily_task_due_at_v1 on public.employee_daily_tasks;
create trigger trg_set_employee_daily_task_due_at_v1
before insert or update of task_date, staff_id, due_at
on public.employee_daily_tasks
for each row
execute function public.set_employee_daily_task_due_at_v1();

create index if not exists idx_employee_daily_tasks_due_pending_v1
  on public.employee_daily_tasks (due_at, task_date)
  where due_at is not null;

do $$
declare
  v_day date := (now() at time zone 'Africa/Cairo')::date;
begin
  update public.employee_daily_tasks
     set due_at = null
   where task_date = v_day
     and due_at is null
     and not public.dawaa_task_status_completed_v1(status);
end;
$$;

create or replace function public.dawaa_notify_overdue_tasks_v1()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  r record;
  v_count integer := 0;
  v_cairo_day date := (now() at time zone 'Africa/Cairo')::date;
begin
  for r in
    select * from public.employee_daily_tasks
    where task_date >= v_cairo_day - 7
      and (
        (due_at is not null and due_at < now())
        or (due_at is null and task_date < v_cairo_day)
      )
      and not public.dawaa_task_status_completed_v1(status)
  loop
    if public.dawaa_insert_task_notification_v1(
      r.id::text, r.staff_id, r.branch,
      'مهمة متأخرة: ' || coalesce(r.task_title,'مهمة يومية'),
      case
        when r.due_at is not null then
          format('المهمة الخاصة بـ %s تجاوزت موعدها %s ولم تُسجل كمكتملة.', coalesce(nullif(r.staff_name,''),'الموظف'), to_char(r.due_at at time zone 'Africa/Cairo','DD/MM/YYYY HH24:MI'))
        else
          format('المهمة الخاصة بـ %s بتاريخ %s لم تُسجل كمكتملة حتى الآن.', coalesce(nullif(r.staff_name,''),'الموظف'), to_char(r.task_date,'DD/MM/YYYY'))
      end,
      coalesce(nullif(r.related_route,''), '/employee-operating-system?taskId=' || r.id::text),
      case when r.priority in ('urgent','critical') then 'urgent' else 'high' end,
      'overdue',
      jsonb_build_object('taskTitle',r.task_title,'taskDate',r.task_date,'staffName',r.staff_name,'dueAt',r.due_at,'source','employee_daily_tasks','requiresFollowup',true)
    ) is not null then v_count := v_count + 1; end if;
  end loop;

  for r in
    select * from public.branch_daily_tasks
    where task_date >= v_cairo_day - 7
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

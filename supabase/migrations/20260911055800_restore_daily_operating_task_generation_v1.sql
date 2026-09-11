-- Restore the source rows that operational task notifications depend on.
-- Task generation stays behind the existing 15-minute notification orchestrator,
-- so no parallel cron or notification workflow is introduced.

create or replace function public.ensure_daily_operating_tasks_v1()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_day date := (now() at time zone 'Africa/Cairo')::date;
  v_staff record;
  v_before_employee integer := 0;
  v_after_employee integer := 0;
  v_before_branch integer := 0;
  v_after_branch integer := 0;
begin
  select count(*) into v_before_employee
  from public.employee_daily_tasks
  where task_date = v_day;

  for v_staff in
    select
      s.id::text as staff_id,
      s.name as staff_name,
      coalesce(sa.role, s.role, 'assistant') as role,
      s.branch
    from public.staff s
    left join public.staff_accounts sa
      on sa.staff_id = s.id::text
     and sa.active = true
     and sa.can_login = true
    where coalesce(s.is_active, true) = true
      and coalesce(s.active, true) = true
      and not exists (
        select 1
        from public.employee_daily_tasks edt
        where edt.staff_id = s.id::text
          and edt.task_date = v_day
      )
  loop
    perform public.generate_employee_daily_tasks(
      v_staff.staff_id,
      v_staff.staff_name,
      v_staff.role,
      v_staff.branch,
      v_day
    );
  end loop;

  select count(*) into v_after_employee
  from public.employee_daily_tasks
  where task_date = v_day;

  select count(*) into v_before_branch
  from public.branch_daily_tasks
  where task_date = v_day
    and branch in ('فرع الشامي','فرع شكري');

  perform * from public.create_daily_branch_tasks('فرع الشامي', v_day, null);
  perform * from public.create_daily_branch_tasks('فرع شكري', v_day, null);

  select count(*) into v_after_branch
  from public.branch_daily_tasks
  where task_date = v_day
    and branch in ('فرع الشامي','فرع شكري');

  return jsonb_build_object(
    'taskDate', v_day,
    'employeeTasksCreated', greatest(v_after_employee - v_before_employee, 0),
    'employeeTasksTotal', v_after_employee,
    'branchTasksCreated', greatest(v_after_branch - v_before_branch, 0),
    'branchTasksTotal', v_after_branch
  );
end;
$function$;

create or replace function public.evaluate_operational_notification_rules_v1()
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_generation jsonb := '{}'::jsonb;
  v_employee_and_branch_tasks integer := 0;
  v_operations_tasks integer := 0;
  v_sla jsonb := '{}'::jsonb;
begin
  -- Ensure the real task sources exist before evaluating task notification rules.
  v_generation := public.ensure_daily_operating_tasks_v1();
  v_employee_and_branch_tasks := public.dawaa_notify_overdue_tasks_v1();
  v_operations_tasks := public.dawaa_notify_overdue_operations_tasks_v1();
  v_sla := public.evaluate_notification_sla_v1();

  return jsonb_build_object(
    'evaluated_at', now(),
    'task_generation', v_generation,
    'employee_and_branch_task_notifications', v_employee_and_branch_tasks,
    'operations_task_notifications', v_operations_tasks,
    'sla', v_sla,
    'total_notifications', v_employee_and_branch_tasks + v_operations_tasks + coalesce((v_sla->>'newBreaches')::integer,0)
  );
end;
$function$;

-- Materialize today's sources immediately; future days are maintained by the existing orchestrator cron.
select public.ensure_daily_operating_tasks_v1();

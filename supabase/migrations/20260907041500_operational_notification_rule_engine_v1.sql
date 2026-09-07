-- Consolidate same-cadence overdue notification producers behind one scheduler entry point.
-- Producer functions remain source-specific; orchestration and scheduling are centralized.

create or replace function public.evaluate_operational_notification_rules_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_employee_and_branch_tasks integer := 0;
  v_operations_tasks integer := 0;
begin
  v_employee_and_branch_tasks := public.dawaa_notify_overdue_tasks_v1();
  v_operations_tasks := public.dawaa_notify_overdue_operations_tasks_v1();

  return jsonb_build_object(
    'evaluated_at', now(),
    'employee_and_branch_task_notifications', v_employee_and_branch_tasks,
    'operations_task_notifications', v_operations_tasks,
    'total_notifications', v_employee_and_branch_tasks + v_operations_tasks
  );
end;
$$;

revoke all on function public.evaluate_operational_notification_rules_v1() from public, anon, authenticated;
grant execute on function public.evaluate_operational_notification_rules_v1() to service_role;

do $$
declare
  v_job record;
begin
  for v_job in
    select jobid
    from cron.job
    where jobname in ('dawaa-overdue-task-notifications-v1','dawaa-overdue-operations-tasks-v1','dawaa-operational-notification-rules-v1')
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;

  perform cron.schedule(
    'dawaa-operational-notification-rules-v1',
    '*/15 * * * *',
    'select public.evaluate_operational_notification_rules_v1();'
  );
end;
$$;

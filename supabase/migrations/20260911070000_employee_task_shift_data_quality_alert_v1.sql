create or replace function public.notify_employee_task_shift_data_gaps_v1()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_today date := (now() at time zone 'Africa/Cairo')::date;
  v_count integer := 0;
  v_missing_count integer := 0;
  v_missing_names text;
  v_manager record;
begin
  select
    count(distinct edt.staff_id)::int,
    string_agg(distinct edt.staff_name, '، ' order by edt.staff_name)
  into v_missing_count, v_missing_names
  from public.employee_daily_tasks edt
  where edt.task_date = v_today
    and edt.due_at is null
    and not public.dawaa_task_status_completed_v1(edt.status)
    and (
      edt.role in ('pharmacist','assistant','rider','team_dawaa_alpha','branch_manager','cleaning')
      or edt.role like 'shift_supervisor%'
    );

  if coalesce(v_missing_count, 0) = 0 then
    return 0;
  end if;

  for v_manager in
    select sa.staff_id::text as staff_id
    from public.staff_accounts sa
    where sa.active = true
      and sa.can_login = true
      and sa.staff_id is not null
      and sa.role in ('general_manager','branches_manager')
  loop
    perform public.emit_system_notification_v2(
      p_recipient_staff_id => v_manager.staff_id,
      p_branch => 'كل الفروع',
      p_notification_type => 'manager_alert',
      p_title => 'بيانات شيفت ناقصة تؤثر على تنبيهات المهام',
      p_message => format('%s موظف لديهم مهام اليوم بدون وقت شيفت موثوق، لذلك لا يمكن تحديد موعد تأخير داخل نفس اليوم. الأسماء: %s', v_missing_count, coalesce(v_missing_names,'غير متاح')),
      p_entity_type => 'employee_task_shift_data_quality',
      p_entity_id => to_char(v_today, 'YYYY-MM-DD'),
      p_action_url => '/employees-accounts',
      p_priority => 'high',
      p_metadata => jsonb_build_object(
        'schemaVersion',2,
        'canonicalType','manager_alert',
        'reportDate',v_today,
        'missingShiftStaffCount',v_missing_count,
        'missingShiftStaffNames',v_missing_names,
        'requiresFollowup',true,
        'source','employee_daily_tasks'
      ),
      p_dedupe_key => 'employee-task-shift-data-gap:' || v_manager.staff_id || ':' || to_char(v_today, 'YYYY-MM-DD'),
      p_requires_action => true,
      p_sound_enabled => false
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

create or replace function public.evaluate_operational_notification_rules_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_generation jsonb := '{}'::jsonb;
  v_employee_and_branch_tasks integer := 0;
  v_operations_tasks integer := 0;
  v_shift_data_quality integer := 0;
  v_sla jsonb := '{}'::jsonb;
begin
  v_generation := public.ensure_daily_operating_tasks_v1();
  v_employee_and_branch_tasks := public.dawaa_notify_overdue_tasks_v1();
  v_operations_tasks := public.dawaa_notify_overdue_operations_tasks_v1();
  v_shift_data_quality := public.notify_employee_task_shift_data_gaps_v1();
  v_sla := public.evaluate_notification_sla_v1();

  return jsonb_build_object(
    'evaluated_at', now(),
    'task_generation', v_generation,
    'employee_and_branch_task_notifications', v_employee_and_branch_tasks,
    'operations_task_notifications', v_operations_tasks,
    'shift_data_quality_notifications', v_shift_data_quality,
    'sla', v_sla,
    'total_notifications', v_employee_and_branch_tasks + v_operations_tasks + v_shift_data_quality + coalesce((v_sla->>'newBreaches')::integer,0)
  );
end;
$$;

select public.notify_employee_task_shift_data_gaps_v1();
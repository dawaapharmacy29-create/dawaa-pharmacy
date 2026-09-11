create or replace function public.resolve_operational_staff_role_v1(p_staff_role text, p_account_role text)
returns text
language sql
immutable
as $$
  select case
    when lower(trim(coalesce(p_account_role,''))) like 'shift_supervisor%'
      and lower(trim(coalesce(p_staff_role,''))) in ('pharmacist','صيدلاني','صيدلي','دكتور','doctor')
      then 'pharmacist'
    when nullif(trim(coalesce(p_account_role,'')),'') is not null
      then lower(trim(p_account_role))
    when nullif(trim(coalesce(p_staff_role,'')),'') is not null
      then lower(trim(p_staff_role))
    else 'assistant'
  end;
$$;

create or replace function public.ensure_daily_operating_tasks_v1()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
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
      public.resolve_operational_staff_role_v1(s.role, sa.role) as role,
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
$$;

do $$
declare
  v_day date := (now() at time zone 'Africa/Cairo')::date;
  r record;
begin
  for r in
    select s.id::text as staff_id, s.name, s.role as staff_role, sa.role as account_role, s.branch
    from public.staff s
    join public.staff_accounts sa on sa.staff_id::text=s.id::text
    where sa.active=true and sa.can_login=true
      and lower(trim(sa.role)) like 'shift_supervisor%'
      and lower(trim(coalesce(s.role,''))) in ('pharmacist','صيدلاني','صيدلي','دكتور','doctor')
  loop
    delete from public.employee_daily_tasks
    where staff_id=r.staff_id
      and task_date=v_day
      and completed_at is null
      and status='pending'
      and source='system'
      and task_key in ('open_daily_workspace','review_customer_or_shift_notes','end_shift_update');

    if not exists (
      select 1 from public.employee_daily_tasks
      where staff_id=r.staff_id and task_date=v_day
    ) then
      perform public.generate_employee_daily_tasks(r.staff_id,r.name,'pharmacist',r.branch,v_day);
    end if;
  end loop;
end;
$$;
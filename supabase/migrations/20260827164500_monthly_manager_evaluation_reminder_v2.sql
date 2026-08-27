create or replace function public.notify_missing_weekly_manager_evaluations()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer := 0;
  v_evaluator record;
  v_cycle_start date;
  v_cycle_end date;
  v_expected integer := 0;
  v_submitted integer := 0;
begin
  if extract(day from current_date) >= 26 then
    v_cycle_start := make_date(extract(year from current_date)::int,extract(month from current_date)::int,26);
    v_cycle_end := (v_cycle_start + interval '1 month - 1 day')::date;
  else
    v_cycle_start := (make_date(extract(year from current_date)::int,extract(month from current_date)::int,26) - interval '1 month')::date;
    v_cycle_end := (v_cycle_start + interval '1 month - 1 day')::date;
  end if;

  if current_date < v_cycle_end - 2 then return 0; end if;

  select count(*)::integer into v_expected
  from public.staff s
  join public.staff_accounts a on a.staff_id=s.id::text
  where coalesce(s.active,s.is_active,true)=true
    and coalesce(a.active,false)=true
    and coalesce(a.can_login,false)=true
    and lower(coalesce(a.role,'')) in ('branch_manager','customer_service_manager');

  for v_evaluator in
    select s.id,s.name
    from public.staff s
    join public.staff_accounts a on a.staff_id=s.id::text
    where coalesce(s.active,s.is_active,true)=true
      and coalesce(a.active,false)=true
      and coalesce(a.can_login,false)=true
      and lower(coalesce(a.role,''))='branches_manager'
  loop
    select count(distinct e.subject_staff_id)::integer into v_submitted
    from public.manager_weekly_evaluations e
    where e.evaluator_staff_id=v_evaluator.id
      and e.status='submitted'
      and e.evaluation_type in ('branch_manager','customer_service')
      and e.week_start=v_cycle_start
      and e.week_end=v_cycle_end;

    if v_submitted < v_expected and not exists (
      select 1 from public.notifications n
      where coalesce(nullif(trim(n.recipient_staff_id),''),nullif(trim(n.staff_id),''))=v_evaluator.id::text
        and n.type='reminder'
        and n.title='التقييم الشهري للإدارة غير مكتمل'
        and n.created_at::date between v_cycle_start and v_cycle_end
    ) then
      insert into public.notifications(
        staff_id,recipient_staff_id,recipient_role,title,body,type,target_type,target_route,route,created_at
      ) values (
        v_evaluator.id::text,v_evaluator.id::text,'branches_manager',
        'التقييم الشهري للإدارة غير مكتمل',
        'متبقي تقييم '||(v_expected-v_submitted)||' من مديري الفروع/خدمة العملاء لدورة '||v_cycle_start||' → '||v_cycle_end||'. التقييم المعتمد هو مصدر حافز الأداء الشهري.',
        'reminder','manager_monthly_evaluation','/weekly-evaluation/branch_manager','/weekly-evaluation/branch_manager',now()
      );
      v_count:=v_count+1;
    end if;
  end loop;
  return v_count;
end;
$function$;

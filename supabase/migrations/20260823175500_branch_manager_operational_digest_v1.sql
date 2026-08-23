insert into public.notification_type_catalog(type, category, audience_scope, default_route, default_priority, is_active, is_legacy, description)
values ('branch_manager_operational_digest','branch_operations','branch_manager','/daily-manager-checklist','high',true,false,'ملخص تشغيلي يومي لمديرة الفرع عند وجود إجراء مطلوب')
on conflict (type) do update set category=excluded.category,audience_scope=excluded.audience_scope,default_route=excluded.default_route,default_priority=excluded.default_priority,is_active=true,is_legacy=false,description=excluded.description,updated_at=now();

create or replace function public.notify_branch_manager_operational_digest()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mgr record;
  v_urgent_new integer;
  v_overdue integer;
  v_penalties integer;
  v_checklist_total integer;
  v_checklist_incomplete integer;
  v_message text;
  v_route text;
  v_count integer := 0;
begin
  for v_mgr in
    select sa.staff_id::uuid as staff_id, trim(coalesce(sa.name,s.name,'')) as staff_name, sa.branch
    from public.staff_accounts sa
    left join public.staff s on s.id::text = sa.staff_id
    where sa.role='branch_manager' and sa.active=true and sa.can_login=true and nullif(trim(coalesce(sa.branch,'')),'') is not null
  loop
    select
      count(*) filter (where status not in ('delivered','cancelled') and coalesce(is_urgent,false)=true and created_at >= now()-interval '24 hours'),
      count(*) filter (where status not in ('delivered','cancelled') and coalesce(due_date,needed_by_date,expected_arrival_date) < current_date)
    into v_urgent_new, v_overdue
    from public.customer_requests
    where branch = v_mgr.branch;

    select count(*)
    into v_penalties
    from public.employee_transactions
    where branch = v_mgr.branch
      and coalesce(status,'active')='active'
      and coalesce(points_delta,0) < 0
      and created_at >= now()-interval '24 hours';

    select count(*), count(*) filter (where completed=false)
    into v_checklist_total, v_checklist_incomplete
    from public.manager_daily_checklist
    where staff_id=v_mgr.staff_id and task_date=current_date;

    if coalesce(v_urgent_new,0)=0 and coalesce(v_overdue,0)=0 and coalesce(v_penalties,0)=0
       and coalesce(v_checklist_incomplete,0)=0 and coalesce(v_checklist_total,0)>0 then
      continue;
    end if;

    v_message := concat_ws(' • ',
      case when coalesce(v_urgent_new,0)>0 then 'طلبات عاجلة جديدة: '||v_urgent_new end,
      case when coalesce(v_overdue,0)>0 then 'طلبات متأخرة: '||v_overdue end,
      case when coalesce(v_penalties,0)>0 then 'خصومات/نقاط سالبة اليوم: '||v_penalties end,
      case when coalesce(v_checklist_total,0)=0 then 'قائمة مهامك اليومية لم تتولد حتى الآن' end,
      case when coalesce(v_checklist_incomplete,0)>0 then 'مهام يومية غير مكتملة: '||v_checklist_incomplete end
    );

    v_route := case
      when coalesce(v_overdue,0)>0 or coalesce(v_urgent_new,0)>0 then '/customer-requests'
      when coalesce(v_checklist_total,0)=0 or coalesce(v_checklist_incomplete,0)>0 then '/daily-manager-checklist'
      else '/points'
    end;

    perform public.create_staff_notification(
      v_mgr.staff_id,
      'branch_manager_operational_digest',
      'ملخص تشغيل الفرع يحتاج مراجعتك',
      v_message,
      'branch_operations',
      v_mgr.branch,
      v_route,
      case when coalesce(v_overdue,0)>0 then 'urgent' else 'high' end,
      jsonb_build_object(
        'branch',v_mgr.branch,
        'urgentNew24h',coalesce(v_urgent_new,0),
        'overdueRequests',coalesce(v_overdue,0),
        'penalties24h',coalesce(v_penalties,0),
        'checklistTotal',coalesce(v_checklist_total,0),
        'checklistIncomplete',coalesce(v_checklist_incomplete,0)
      ),
      'branch-manager-digest:'||v_mgr.staff_id::text||':'||current_date::text,
      null,
      v_mgr.branch
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

do $$
begin
  if exists (select 1 from pg_extension where extname='pg_cron') then
    if exists (select 1 from cron.job where jobname='branch-manager-operational-digest-v1') then
      perform cron.unschedule((select jobid from cron.job where jobname='branch-manager-operational-digest-v1' limit 1));
    end if;
    perform cron.schedule('branch-manager-operational-digest-v1','30 14 * * *','select public.notify_branch_manager_operational_digest();');
  end if;
end;
$$;

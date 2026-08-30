-- Align active points/incentive cron writers to the pharmacy 26→25 cycle.

create or replace function public.dawaa_points_cycle_start_for_label_v1(p_month_cycle text)
returns date
language plpgsql
immutable
set search_path to 'public','pg_catalog'
as $function$
begin
  if coalesce(trim(p_month_cycle),'') !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid points cycle label: %', p_month_cycle using errcode='22023';
  end if;
  return (date_trunc('month', to_date(p_month_cycle || '-01','YYYY-MM-DD')) - interval '1 month' + interval '25 days')::date;
end;
$function$;

create or replace function public.dawaa_points_cycle_end_for_label_v1(p_month_cycle text)
returns date
language plpgsql
immutable
set search_path to 'public','pg_catalog'
as $function$
begin
  if coalesce(trim(p_month_cycle),'') !~ '^\d{4}-\d{2}$' then
    raise exception 'invalid points cycle label: %', p_month_cycle using errcode='22023';
  end if;
  return to_date(p_month_cycle || '-25','YYYY-MM-DD');
end;
$function$;

create or replace function public.settle_assistant_checklist_points()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count int := 0;
  v_row record;
  v_task record;
  v_cycle_start date;
  v_cycle_end date;
  v_cycle_label text;
  v_weights jsonb := '{"inventory_count":20,"purchase_invoices_entry":20,"shelving":15,"expiry_tracking":15,"stock_requests":10,"storage_cleanliness":10,"peak_support":10}'::jsonb;
  v_working_days int;
  v_rate numeric;
  v_points numeric;
  v_existing_id uuid;
begin
  v_cycle_label := public.dawaa_current_points_cycle_label_v1();
  v_cycle_start := public.dawaa_points_cycle_start_for_label_v1(v_cycle_label);
  v_cycle_end := public.dawaa_points_cycle_end_for_label_v1(v_cycle_label);
  v_working_days := greatest(1, (least((now() at time zone 'Africa/Cairo')::date, v_cycle_end) - v_cycle_start) + 1);

  for v_row in
    select s.id as staff_id, s.name as staff_name, sa.branch
    from staff s
    join staff_accounts sa on sa.staff_id = s.id::text
    where sa.role = 'assistant' and sa.active = true and sa.can_login = true
  loop
    for v_task in select key, value::numeric as weight from jsonb_each_text(v_weights)
    loop
      select round((count(*) filter (where completed))::numeric / v_working_days * 100, 1)
        into v_rate
      from manager_daily_checklist
      where staff_id = v_row.staff_id and task_key = v_task.key
        and task_date between v_cycle_start and least((now() at time zone 'Africa/Cairo')::date, v_cycle_end);

      v_rate := coalesce(least(100, v_rate), 0);
      v_points := round(v_task.weight * v_rate / 100, 1);

      select id into v_existing_id from employee_transactions
      where staff_id = v_row.staff_id and source = 'assistant_checklist_settlement'
        and month_cycle = v_cycle_label and description like '%' || v_task.key || '%'
      limit 1;

      if v_existing_id is not null then
        update employee_transactions set points=v_points,points_delta=v_points,updated_at=now() where id=v_existing_id;
      else
        insert into employee_transactions(staff_id,type,points,points_delta,reason,source,month_cycle,branch,status,employee_name,created_by,description,category)
        values(v_row.staff_id,'reward',v_points,v_points,'تسوية مهام المساعد اليومية — '||v_task.key,'assistant_checklist_settlement',v_cycle_label,v_row.branch,'active',v_row.staff_name,'system_automation','ASSIST-CHECKLIST['||v_task.key||'] — معدل إنجاز '||v_rate||'% × وزن '||v_task.weight,'مهام مساعد الصيدلي');
      end if;
      v_count:=v_count+1;
    end loop;
  end loop;
  return v_count;
end;
$function$;

create or replace function public.settle_daily_checklist_responsibility()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row record; v_staff record; v_staff_count integer; v_share integer; v_count integer := 0; v_reporting_manager uuid; v_month_cycle text;
begin
  for v_row in
    select c.id checklist_id,c.branch,c.task_date,c.task_key,c.note,c.staff_id reporter_staff_id,r.responsible_role,r.rule_key,e.title,e.points
    from public.manager_daily_checklist c
    join public.daily_checklist_task_responsibility r on r.task_key=c.task_key
    join public.evaluation_rules e on e.rule_key=r.rule_key
    where c.completed=false and c.task_date >= (now() at time zone 'Africa/Cairo')::date - interval '1 day'
      and not exists(select 1 from public.employee_transactions t where t.source='daily_checklist_responsibility' and t.source_id=c.id)
  loop
    v_month_cycle := public.dawaa_points_cycle_label_for_date_v3(v_row.task_date);
    select count(*) into v_staff_count from public.staff where role=v_row.responsible_role and branch=v_row.branch and coalesce(is_active,true)=true;
    if v_staff_count=0 then continue; end if;
    v_share:=round(v_row.points::numeric/v_staff_count);
    for v_staff in select id,name from public.staff where role=v_row.responsible_role and branch=v_row.branch and coalesce(is_active,true)=true loop
      insert into public.employee_transactions(staff_id,type,points,points_delta,amount,reason,source,source_id,month_cycle,branch,status,employee_name,created_by,description,category,employee_visible)
      values(v_staff.id,'penalty',v_share,-v_share,0,v_row.title,'daily_checklist_responsibility',v_row.checklist_id,v_month_cycle,v_row.branch,'active',v_staff.name,'system_automation','بند "'||v_row.task_key||'" في تدقيق مدير الفرع يوم '||v_row.task_date||' اتسجل غير منجز.'||coalesce(' ملاحظة المدير: '||v_row.note,''),'الالتزام والانضباط',true);
      v_count:=v_count+1;
      perform public.create_staff_notification(v_staff.id,'daily_audit_failed','خصم من تدقيق مدير الفرع اليومي','بند "'||v_row.title||'" اتسجل غير منجز في تدقيق '||v_row.task_date||' — خصم '||v_share||' نقطة.'||coalesce(' ملاحظة المدير: '||v_row.note,''),'manager_daily_checklist',v_row.checklist_id::text,'/my-daily-checklist','high',jsonb_build_object('taskKey',v_row.task_key,'points',v_share),'daily-audit-fail:'||v_row.checklist_id::text||':'||v_staff.id::text,v_row.reporter_staff_id,v_row.branch);
    end loop;
    if v_row.reporter_staff_id is not null then
      perform public.create_staff_notification(v_row.reporter_staff_id,'daily_audit_note_applied','ملاحظتك اتطبقت: '||v_row.title,'خصم '||v_share||' نقطة لكل مسؤول ('||v_staff_count||' شخص) عن بند "'||v_row.title||'" بتاريخ '||v_row.task_date||'.','manager_daily_checklist',v_row.checklist_id::text,'/daily-manager-checklist','normal',jsonb_build_object('taskKey',v_row.task_key),'daily-audit-confirm:'||v_row.checklist_id::text,null,v_row.branch);
    end if;
  end loop;
  return v_count;
end;
$function$;

create or replace function public.refresh_doctor_followup_points(p_month_cycle text default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_count integer:=0; v_cycle_label text:=coalesce(nullif(trim(p_month_cycle),''),public.dawaa_current_points_cycle_label_v1()); v_cycle_start date; v_cycle_end date;
begin
  v_cycle_start:=public.dawaa_points_cycle_start_for_label_v1(v_cycle_label);
  v_cycle_end:=public.dawaa_points_cycle_end_for_label_v1(v_cycle_label);
  delete from public.employee_transactions where source='followup_activity_pillar' and month_cycle=v_cycle_label;
  with valid_followups as (
    select f.*,row_number() over(partition by f.assigned_doctor,f.created_at::date order by f.created_at) daily_rank
    from public.daily_followups f
    where f.created_at>=v_cycle_start::timestamp and f.created_at<(v_cycle_end+1)::timestamp and coalesce(f.counts_toward_quota,true)=true and f.assigned_doctor is not null
  ), doctor_totals as (
    select assigned_doctor,count(*) total_registered from valid_followups group by assigned_doctor
  ), capped_points as (
    select vf.assigned_doctor,row_number() over(partition by vf.assigned_doctor order by vf.created_at) month_rank,vf.points_value from valid_followups vf where vf.daily_rank<=10
  ), doctor_points as (
    select dt.assigned_doctor,dt.total_registered,case when dt.total_registered<50 then 0 else coalesce((select sum(cp.points_value) from capped_points cp where cp.assigned_doctor=dt.assigned_doctor and cp.month_rank<=150),0) end final_points from doctor_totals dt
  ), matched_staff as (
    select dp.*,s.id staff_id,s.branch from doctor_points dp join public.staff s on public.dawaa_normalize_doctor_name(s.name)=public.dawaa_normalize_doctor_name(dp.assigned_doctor) where s.role='صيدلاني' and coalesce(s.is_active,true)=true
  )
  insert into public.employee_transactions(staff_id,employee_name,type,title,points,points_delta,base_points,final_points,source,category,month_cycle,branch,status,employee_visible,description,created_by)
  select ms.staff_id,ms.assigned_doctor,'reward','نقاط المتابعات الشهرية',ms.final_points,ms.final_points,ms.final_points,ms.final_points,'followup_activity_pillar','المتابعات',v_cycle_label,ms.branch,'active',true,format('%s متابعة مسجلة في دورة %s (الحد الأدنى 50 %s، السقف 150)',ms.total_registered,v_cycle_label,case when ms.total_registered<50 then '- لم يتحقق، صفر نقاط' else '- تحقق' end),'system_followup_refresh' from matched_staff ms;
  get diagnostics v_count=row_count; return v_count;
end;
$function$;

create or replace function public.settle_doctor_threshold_bonuses()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_month_cycle text:=public.dawaa_current_points_cycle_label_v1(); v_cycle_start date:=public.dawaa_points_cycle_start_for_label_v1(v_month_cycle); v_cycle_end date:=public.dawaa_points_cycle_end_for_label_v1(v_month_cycle); v_row record; v_count integer:=0;
begin
  for v_row in select s.id doctor_id,s.name doctor_name,s.branch,count(*) followup_count from public.staff s join public.daily_followups f on f.requested_by_staff_id=s.id::text and f.request_type='متابعة استثنائية' and f.created_at>=v_cycle_start::timestamp and f.created_at<(v_cycle_end+1)::timestamp where s.role='صيدلاني' and coalesce(s.is_active,true)=true group by s.id,s.name,s.branch having count(*)>=25 loop
    if not exists(select 1 from public.employee_transactions where staff_id=v_row.doctor_id and source='doctor_followup_threshold_bonus' and month_cycle=v_month_cycle) then
      insert into public.employee_transactions(staff_id,type,points,points_delta,amount,reason,source,month_cycle,branch,status,employee_name,created_by,description,category,employee_visible)
      values(v_row.doctor_id,'reward',0,0,150,'وصول هدف المتابعات في دورة 26→25','doctor_followup_threshold_bonus',v_month_cycle,v_row.branch,'active',v_row.doctor_name,'system_automation','سجّل '||v_row.followup_count||' متابعة بنفسه في دورة '||v_month_cycle||' — تجاوز الهدف (25). حافز مستقل 150 جنيه.','الحافز الشهري',true); v_count:=v_count+1;
    end if;
  end loop;
  for v_row in select s.id doctor_id,s.name doctor_name,s.branch,count(*) request_count from public.staff s join public.customer_requests r on r.doctor_id=s.id and r.created_by=s.id::text and r.created_at>=v_cycle_start::timestamp and r.created_at<(v_cycle_end+1)::timestamp where s.role='صيدلاني' and coalesce(s.is_active,true)=true group by s.id,s.name,s.branch having count(*)>=30 loop
    if not exists(select 1 from public.employee_transactions where staff_id=v_row.doctor_id and source='doctor_customer_request_threshold_bonus' and month_cycle=v_month_cycle) then
      insert into public.employee_transactions(staff_id,type,points,points_delta,amount,reason,source,month_cycle,branch,status,employee_name,created_by,description,category,employee_visible)
      values(v_row.doctor_id,'reward',0,0,150,'وصول هدف طلبات العملاء في دورة 26→25','doctor_customer_request_threshold_bonus',v_month_cycle,v_row.branch,'active',v_row.doctor_name,'system_automation','سجّل '||v_row.request_count||' طلب عميل بنفسه في دورة '||v_month_cycle||' — تجاوز الهدف (30). حافز مستقل 150 جنيه.','الحافز الشهري',true); v_count:=v_count+1;
    end if;
  end loop;
  return v_count;
end;
$function$;

delete from public.employee_transactions where source='assistant_checklist_settlement' and month_cycle='2026-08' and created_at>=timestamptz '2026-08-26 00:00:00+03' and coalesce(points_delta,0)=0 and coalesce(amount,0)=0;
delete from public.employee_transactions where source='followup_activity_pillar' and month_cycle='2026-08' and created_at>=timestamptz '2026-08-26 00:00:00+03' and coalesce(points_delta,0)=0 and coalesce(amount,0)=0;
select public.settle_assistant_checklist_points();
select public.refresh_doctor_followup_points(public.dawaa_current_points_cycle_label_v1());

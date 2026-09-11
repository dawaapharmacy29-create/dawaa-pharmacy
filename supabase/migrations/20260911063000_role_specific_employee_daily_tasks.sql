-- Replace generic 3-row employee task generation with role-specific operational tasks.
-- Keeps the existing employee_daily_tasks source and Notification Architecture V2 workflow.

create or replace function public.generate_employee_daily_tasks(
  p_staff_id text,
  p_staff_name text,
  p_role text,
  p_branch text,
  p_task_date date default current_date
)
returns setof public.employee_daily_tasks
language plpgsql
as $function$
declare
  v_role text := lower(trim(coalesce(p_role, 'assistant')));
begin
  if v_role in ('pharmacist','صيدلاني','صيدلي','دكتور','doctor') then
    insert into public.employee_daily_tasks (
      staff_id, staff_name, role, branch, task_key, task_title, task_description,
      task_date, status, priority, source, related_route, related_entity_type, related_entity_id
    ) values
      (p_staff_id,p_staff_name,'pharmacist',p_branch,'pharmacist.avg_invoice','مراجعة متوسط الفاتورة','راجع متوسط فاتورتك مقارنة بالفرع وحدد فرصة التحسين.',p_task_date,'pending','high','role_profile','/staff-dashboard','role_profile','pharmacist'),
      (p_staff_id,p_staff_name,'pharmacist',p_branch,'pharmacist.uncoded','مراجعة فواتيرك بدون كود','راجع الفواتير غير المرتبطة بعميل وأكمل التكويد المطلوب.',p_task_date,'pending','high','role_profile','/customer-coding','role_profile','pharmacist'),
      (p_staff_id,p_staff_name,'pharmacist',p_branch,'pharmacist.reviews','مراجعة تقييمات المحادثات','راجع أي تقييم سلبي أو ملاحظة خدمة عملاء مرتبطة بك.',p_task_date,'pending','normal','role_profile','/reviews','role_profile','pharmacist'),
      (p_staff_id,p_staff_name,'pharmacist',p_branch,'pharmacist.cross_sell','مراجعة فرص Cross Sell','راجع فرص البيع الإضافي المناسبة بدون ضغط على العميل.',p_task_date,'pending','normal','role_profile','/stagnant-medicines','role_profile','pharmacist'),
      (p_staff_id,p_staff_name,'pharmacist',p_branch,'pharmacist.welcome','تسجيل رسالة ترحيبية مطلوبة','راجع العملاء الجدد وسجل الترحيب والمتابعة المطلوبة.',p_task_date,'pending','normal','role_profile','/welcome-messages','role_profile','pharmacist')
    on conflict do nothing;

  elsif v_role in ('assistant','مساعد','مساعد صيدلي') then
    insert into public.employee_daily_tasks (
      staff_id, staff_name, role, branch, task_key, task_title, task_description,
      task_date, status, priority, source, related_route, related_entity_type, related_entity_id
    ) values
      (p_staff_id,p_staff_name,'assistant',p_branch,'assistant.work_area','ترتيب منطقة العمل','تأكد من ترتيب منطقة التجهيز قبل وأثناء الشيفت.',p_task_date,'pending','normal','role_profile','/shelf-organization','role_profile','assistant'),
      (p_staff_id,p_staff_name,'assistant',p_branch,'assistant.shortages','مراجعة النواقص','راجع النواقص وبلغ المسؤول عن الأصناف المؤثرة.',p_task_date,'pending','high','role_profile','/shortages','role_profile','assistant'),
      (p_staff_id,p_staff_name,'assistant',p_branch,'assistant.delivery_prepare','تجهيز طلبات الدليفري بدقة','تأكد من الأصناف والفاتورة قبل التسليم للمندوب.',p_task_date,'pending','high','role_profile','/delivery','role_profile','assistant'),
      (p_staff_id,p_staff_name,'assistant',p_branch,'assistant.counter_clean','تأكيد نظافة الكاونتر','راجع نظافة الكاونتر ومنطقة العملاء.',p_task_date,'pending','normal','role_profile','/my-daily-checklist','role_profile','assistant'),
      (p_staff_id,p_staff_name,'assistant',p_branch,'assistant.inventory_issue','الإبلاغ عن مشكلة مخزون','سجل أي مشكلة مخزون أو رصيد غير طبيعي بوضوح.',p_task_date,'pending','normal','role_profile','/stock-alerts','role_profile','assistant')
    on conflict do nothing;

  elsif v_role in ('branch_manager','مدير فرع','مديرة فرع') then
    insert into public.employee_daily_tasks (
      staff_id, staff_name, role, branch, task_key, task_title, task_description,
      task_date, status, priority, source, related_route, related_entity_type, related_entity_id
    ) values
      (p_staff_id,p_staff_name,'branch_manager',p_branch,'branch_manager.sales','مراجعة مبيعات اليوم','راجع مبيعات الفرع ونسبة تحقيق الهدف.',p_task_date,'pending','high','role_profile','/daily-target','role_profile','branch_manager'),
      (p_staff_id,p_staff_name,'branch_manager',p_branch,'branch_manager.shift','مراجعة الموجودين في الشيفت','تأكد من الحضور والانصراف والمتأخرين والغائبين.',p_task_date,'pending','high','role_profile','/attendance-report','role_profile','branch_manager'),
      (p_staff_id,p_staff_name,'branch_manager',p_branch,'branch_manager.manager_customers','مراجعة عملاء يحتاجون مدير','راجع حالات العملاء التي تحتاج تدخل إداري.',p_task_date,'pending','high','role_profile','/customer-service?needsManager=1','role_profile','branch_manager'),
      (p_staff_id,p_staff_name,'branch_manager',p_branch,'branch_manager.uncoded_invoices','مراجعة الفواتير بدون كود','راجع الفواتير غير المرتبطة بعميل.',p_task_date,'pending','normal','role_profile','/customer-coding','role_profile','branch_manager'),
      (p_staff_id,p_staff_name,'branch_manager',p_branch,'branch_manager.shift_note','تسجيل ملاحظة شيفت','سجل أي ملاحظة تشغيلية واضحة للفريق.',p_task_date,'pending','normal','role_profile','/shift-notes','role_profile','branch_manager'),
      (p_staff_id,p_staff_name,'branch_manager',p_branch,'branch_manager.cleanliness','تأكيد نظافة الفرع','راجع الكاونتر والأرضية والأرفف ومنطقة العملاء.',p_task_date,'pending','normal','role_profile','/branch-checklist-review','role_profile','branch_manager')
    on conflict do nothing;

  elsif v_role in ('branches_manager','مدير الفروع','مديرة الفروع') then
    insert into public.employee_daily_tasks (
      staff_id, staff_name, role, branch, task_key, task_title, task_description,
      task_date, status, priority, source, related_route, related_entity_type, related_entity_id
    ) values
      (p_staff_id,p_staff_name,'branches_manager',p_branch,'branches_manager.branch_targets','مراجعة أداء الفروع','راجع المبيعات والتارجت والفجوة بين الفروع.',p_task_date,'pending','high','role_profile','/branch-comparison','role_profile','branches_manager'),
      (p_staff_id,p_staff_name,'branches_manager',p_branch,'branches_manager.critical_issues','مراجعة المشكلات الحرجة','تأكد من المسؤول والموعد والتصعيد المناسب.',p_task_date,'pending','urgent','role_profile','/operations-center','role_profile','branches_manager'),
      (p_staff_id,p_staff_name,'branches_manager',p_branch,'branches_manager.availability','مراجعة التوافر والنواقص','راجع النواقص الحرجة والمشتريات والتحويلات.',p_task_date,'pending','high','role_profile','/shortages','role_profile','branches_manager'),
      (p_staff_id,p_staff_name,'branches_manager',p_branch,'branches_manager.manager_execution','متابعة تنفيذ مديري الفروع','راجع المهام المتأخرة وملاحظات الشيفت.',p_task_date,'pending','high','role_profile','/daily-manager-checklist','role_profile','branches_manager'),
      (p_staff_id,p_staff_name,'branches_manager',p_branch,'branches_manager.customer_health','مراجعة جودة خدمة العملاء','راجع المتابعات المتأخرة والعملاء المهمين.',p_task_date,'pending','normal','role_profile','/customer-service-dashboard','role_profile','branches_manager'),
      (p_staff_id,p_staff_name,'branches_manager',p_branch,'branches_manager.infrastructure','استمرارية التشغيل','راجع أي أعطال تؤثر على الكاميرات أو النت أو نقاط البيع.',p_task_date,'pending','normal','role_profile','/branch-inspection','role_profile','branches_manager')
    on conflict do nothing;

  elsif v_role in ('rider','delivery','توصيل','مندوب توصيل') then
    insert into public.employee_daily_tasks (
      staff_id, staff_name, role, branch, task_key, task_title, task_description,
      task_date, status, priority, source, related_route, related_entity_type, related_entity_id
    ) values
      (p_staff_id,p_staff_name,'rider',p_branch,'rider.clock_in','تسجيل الحضور','تأكد من تسجيل بداية الشيفت.',p_task_date,'pending','high','role_profile','/attendance-report','role_profile','rider'),
      (p_staff_id,p_staff_name,'rider',p_branch,'rider.open_orders','مراجعة الأوردرات المفتوحة','راجع أي أوردر غير مغلق أو متأخر.',p_task_date,'pending','urgent','role_profile','/delivery','role_profile','rider'),
      (p_staff_id,p_staff_name,'rider',p_branch,'rider.delivered','إغلاق الأوردرات المسلمة','حدّث حالة كل أوردر تم تسليمه.',p_task_date,'pending','high','role_profile','/delivery','role_profile','rider'),
      (p_staff_id,p_staff_name,'rider',p_branch,'rider.failed_reason','تسجيل سبب الفشل','سجل سبب فشل التسليم بوضوح.',p_task_date,'pending','normal','role_profile','/delivery','role_profile','rider'),
      (p_staff_id,p_staff_name,'rider',p_branch,'rider.missing_invoices','مراجعة الفواتير الناقصة','أكمل رقم الفاتورة أو البيانات الناقصة.',p_task_date,'pending','normal','role_profile','/delivery','role_profile','rider')
    on conflict do nothing;

  elsif v_role in ('team_dawaa_alpha','فريق دواء ألفا','فريق_دواء_ألفا') then
    insert into public.employee_daily_tasks (
      staff_id, staff_name, role, branch, task_key, task_title, task_description,
      task_date, status, priority, source, related_route, related_entity_type, related_entity_id
    ) values
      (p_staff_id,p_staff_name,'team_dawaa_alpha',p_branch,'team_dawaa_alpha.daily_track','تنفيذ مسار فريق دواء ألفا اليوم','افتح المسار الأسبوعي ونفذ الـChecklist والمتابعات المطلوبة لليوم.',p_task_date,'pending','high','role_profile','/my-daily-checklist','role_profile','team_dawaa_alpha')
    on conflict do nothing;

  else
    insert into public.employee_daily_tasks (
      staff_id, staff_name, role, branch, task_key, task_title, task_description,
      task_date, status, priority, source, related_route, related_entity_type, related_entity_id
    ) values
      (p_staff_id,p_staff_name,v_role,p_branch,'open_daily_workspace','فتح مساحة العمل اليومية','مراجعة مهام اليوم والأولويات قبل بداية الشيفت.',p_task_date,'pending','high','system','/employee-operating-system','role_profile',v_role),
      (p_staff_id,p_staff_name,v_role,p_branch,'review_customer_or_shift_notes','مراجعة الملاحظات المطلوبة','مراجعة ملاحظات الشيفت أو العملاء حسب الدور والفرع.',p_task_date,'pending','high','system','/shift-notes','role_profile',v_role),
      (p_staff_id,p_staff_name,v_role,p_branch,'end_shift_update','تحديث نهاية الشيفت','تسجيل ما تم أو ما يحتاج متابعة قبل انتهاء الشيفت.',p_task_date,'pending','normal','system','/employee-operating-system','role_profile',v_role)
    on conflict do nothing;
  end if;

  return query
  select * from public.employee_daily_tasks
  where coalesce(staff_id, staff_name, '') = coalesce(p_staff_id, p_staff_name, '')
    and task_date = p_task_date
  order by priority desc, created_at desc;
end;
$function$;

-- Replace only today's untouched generic auto-generated tasks so the current day immediately
-- reflects each role's real operational checklist. Completed/history rows are never removed.
delete from public.employee_daily_tasks
where task_date = (now() at time zone 'Africa/Cairo')::date
  and completed_at is null
  and status = 'pending'
  and source = 'system'
  and task_key in ('open_daily_workspace','review_customer_or_shift_notes','end_shift_update');

select public.ensure_daily_operating_tasks_v1();
-- Employee daily operating tasks.
-- Safe additive migration: table, indexes, and RPC functions only.

create table if not exists public.employee_daily_tasks (
  id uuid primary key default gen_random_uuid(),
  staff_id text null,
  staff_name text null,
  role text null,
  branch text null,
  task_key text not null,
  task_title text not null,
  task_description text null,
  task_date date not null default current_date,
  status text not null default 'pending',
  priority text not null default 'normal',
  source text not null default 'system',
  related_route text null,
  related_entity_type text null,
  related_entity_id text null,
  completed_at timestamptz null,
  completed_by text null,
  completed_by_name text null,
  notes text null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.employee_daily_tasks
  add column if not exists staff_id text null,
  add column if not exists staff_name text null,
  add column if not exists role text null,
  add column if not exists branch text null,
  add column if not exists task_key text,
  add column if not exists task_title text,
  add column if not exists task_description text null,
  add column if not exists task_date date not null default current_date,
  add column if not exists status text not null default 'pending',
  add column if not exists priority text not null default 'normal',
  add column if not exists source text not null default 'system',
  add column if not exists related_route text null,
  add column if not exists related_entity_type text null,
  add column if not exists related_entity_id text null,
  add column if not exists completed_at timestamptz null,
  add column if not exists completed_by text null,
  add column if not exists completed_by_name text null,
  add column if not exists notes text null,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create unique index if not exists idx_employee_daily_tasks_unique_staff_day_key
  on public.employee_daily_tasks (coalesce(staff_id, ''), task_date, task_key);

create index if not exists idx_employee_daily_tasks_staff_id on public.employee_daily_tasks (staff_id);
create index if not exists idx_employee_daily_tasks_task_date on public.employee_daily_tasks (task_date);
create index if not exists idx_employee_daily_tasks_status on public.employee_daily_tasks (status);
create index if not exists idx_employee_daily_tasks_role on public.employee_daily_tasks (role);
create index if not exists idx_employee_daily_tasks_branch on public.employee_daily_tasks (branch);
create index if not exists idx_employee_daily_tasks_updated_at on public.employee_daily_tasks (updated_at desc);

create or replace function public.employee_operating_actor_id()
returns text
language sql
stable
as $$
  select coalesce(
    nullif((nullif(current_setting('request.headers', true), '')::json ->> 'x-dawaa-user-id'), ''),
    nullif(current_setting('request.jwt.claim.sub', true), '')
  )
$$;

create or replace function public.employee_operating_actor_role()
returns text
language sql
security definer
set search_path = public
as $$
  select lower(coalesce(role, ''))
  from public.staff_accounts
  where id::text = public.employee_operating_actor_id()
    and coalesce(active, true) = true
    and coalesce(can_login, true) = true
  limit 1
$$;

create or replace function public.employee_operating_actor_branch()
returns text
language sql
security definer
set search_path = public
as $$
  select branch
  from public.staff_accounts
  where id::text = public.employee_operating_actor_id()
    and coalesce(active, true) = true
    and coalesce(can_login, true) = true
  limit 1
$$;

create or replace function public.employee_operating_can_manage()
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce(public.employee_operating_actor_role(), '') = any(
    array['general_manager','admin','executive_manager','branches_manager','branch_manager','customer_service_manager']
  )
$$;

create or replace function public.fetch_employee_daily_tasks(
  p_task_date date default current_date,
  p_branch text default null,
  p_role text default null,
  p_status text default null,
  p_staff_id text default null,
  p_limit integer default 100,
  p_offset integer default 0
)
returns setof public.employee_daily_tasks
language sql
security definer
set search_path = public
as $$
  select *
  from public.employee_daily_tasks t
  where t.task_date = coalesce(p_task_date, current_date)
    and (p_staff_id is null or t.staff_id = p_staff_id)
    and (p_role is null or p_role in ('all','الكل') or t.role = p_role)
    and (p_status is null or p_status in ('all','الكل') or t.status = p_status)
    and (
      p_branch is null
      or p_branch in ('all','الكل','كل الفروع')
      or t.branch = p_branch
    )
    and (
      public.employee_operating_actor_role() = any(array['general_manager','admin','executive_manager','branches_manager'])
      or (
        public.employee_operating_actor_role() = any(array['branch_manager','customer_service_manager'])
        and coalesce(t.branch, '') = coalesce(public.employee_operating_actor_branch(), '')
      )
      or t.staff_id = public.employee_operating_actor_id()
      or public.employee_operating_actor_id() is null
    )
  order by
    case t.priority when 'urgent' then 3 when 'high' then 2 else 1 end desc,
    t.updated_at desc nulls last
  limit least(greatest(coalesce(p_limit, 100), 1), 200)
  offset greatest(coalesce(p_offset, 0), 0)
$$;

create or replace function public.complete_employee_daily_task(
  p_task_id uuid,
  p_notes text default null,
  p_completed_by text default null,
  p_completed_by_name text default null
)
returns public.employee_daily_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_task public.employee_daily_tasks;
begin
  select * into v_task
  from public.employee_daily_tasks
  where id = p_task_id;

  if v_task.id is null then
    raise exception 'task_not_found';
  end if;

  if not (
    public.employee_operating_can_manage()
    or coalesce(v_task.staff_id, '') = coalesce(public.employee_operating_actor_id(), '')
    or public.employee_operating_actor_id() is null
  ) then
    raise exception 'not_allowed_to_complete_task';
  end if;

  update public.employee_daily_tasks
  set status = 'completed',
      completed_at = now(),
      completed_by = coalesce(nullif(p_completed_by, ''), public.employee_operating_actor_id()),
      completed_by_name = nullif(p_completed_by_name, ''),
      notes = nullif(p_notes, ''),
      updated_at = now()
  where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;

create or replace function public.generate_employee_daily_tasks(
  p_staff_id text,
  p_staff_name text,
  p_role text,
  p_branch text,
  p_task_date date default current_date
)
returns setof public.employee_daily_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := coalesce(nullif(p_role, ''), 'assistant');
  v_task jsonb;
  v_tasks jsonb;
begin
  if not (
    public.employee_operating_can_manage()
    or coalesce(p_staff_id, '') = coalesce(public.employee_operating_actor_id(), '')
    or public.employee_operating_actor_id() is null
  ) then
    raise exception 'not_allowed_to_generate_tasks';
  end if;

  v_tasks := case v_role
    when 'branch_manager' then
      '[["branch_manager.sales","مراجعة مبيعات اليوم","راجع مبيعات الفرع ونسبة تحقيق الهدف.","high","/daily-target"],["branch_manager.shift","مراجعة الموجودين في الشيفت","تأكد من الحضور والانصراف والمتأخرين والغائبين.","high","/attendance-report"],["branch_manager.manager_customers","مراجعة عملاء يحتاجون مدير","افتح حالات العملاء التي تحتاج تدخل إداري.","high","/customer-service?needsManager=1"],["branch_manager.uncoded_invoices","مراجعة الفواتير بدون كود","راجع الفواتير غير المرتبطة بعميل.","normal","/customer-coding"],["branch_manager.shift_note","تسجيل ملاحظة شيفت","سجل ملاحظة تشغيلية واضحة للفريق.","normal","/shift-notes"],["branch_manager.cleanliness","تأكيد نظافة الفرع","راجع الكاونتر والأرضية والأرفف ومنطقة العملاء.","normal","/branch-cleaning"]]'::jsonb
    when 'customer_service_manager' then
      '[["customer_service_manager.today_followups","مراجعة قائمة متابعات اليوم","راجع التوزيع والحالات المفتوحة.","high","/customer-service?tab=today"],["customer_service_manager.late_followups","مراجعة المتأخر","تابع المتابعات المتأخرة قبل نهاية اليوم.","urgent","/customer-service?status=late"],["customer_service_manager.needs_manager","مراجعة يحتاج مدير","افتح الحالات التي تحتاج قرار مدير.","high","/customer-service?needsManager=1"],["customer_service_manager.contacted_no_sale","مراجعة تواصل ولم يشتر","حلل أسباب عدم الشراء وسجل القرار.","normal","/customer-service"],["customer_service_manager.welcome","متابعة الرسائل الترحيبية","راجع مهام الرسائل الترحيبية المفتوحة.","normal","/welcome-messages"],["customer_service_manager.quick_replies","مراجعة الردود السريعة","راجع أكثر الردود استخدامًا وجودتها.","normal","/quick-replies"]]'::jsonb
    when 'pharmacist' then
      '[["pharmacist.avg_invoice","مراجعة متوسط الفاتورة","راجع متوسطك مقارنة بالفرع.","high","/staff-dashboard"],["pharmacist.uncoded","مراجعة فواتيرك بدون كود","تابع الفواتير غير المرتبطة بعميل.","high","/customer-coding"],["pharmacist.reviews","مراجعة تقييمات المحادثات","راجع أي تقييم سلبي مرتبط بك.","normal","/reviews"],["pharmacist.cross_sell","مراجعة فرص Cross Sell","اختر فرص بيع إضافي مناسبة بدون ضغط.","normal","/stagnant-medicines"],["pharmacist.welcome","تسجيل رسالة ترحيبية مطلوبة","سجل الترحيب عند الحاجة.","normal","/welcome-messages"]]'::jsonb
    when 'assistant' then
      '[["assistant.work_area","ترتيب منطقة العمل","تأكد من ترتيب منطقة التجهيز.","normal","/shelf-organization"],["assistant.shortages","مراجعة النواقص","راجع النواقص وبلغ المسؤول.","high","/shortages"],["assistant.delivery_prepare","تجهيز طلبات الدليفري بدقة","تأكد من الأصناف والفاتورة قبل التسليم.","high","/delivery"],["assistant.counter_clean","تأكيد نظافة الكاونتر","راجع نظافة الكاونتر ومنطقة العملاء.","normal","/branch-cleaning"],["assistant.inventory_issue","الإبلاغ عن مشكلة مخزون","سجل أي مشكلة مخزون واضحة.","normal","/stock-alerts"]]'::jsonb
    when 'rider' then
      '[["rider.clock_in","تسجيل الحضور","سجل بداية الشيفت.","high","/attendance-report"],["rider.open_orders","مراجعة الأوردرات المفتوحة","راجع أي أوردر غير مغلق.","urgent","/delivery"],["rider.delivered","إغلاق الأوردرات المسلمة","حدّث حالة كل أوردر تم تسليمه.","high","/delivery"],["rider.failed_reason","تسجيل سبب الفشل","سجل سبب فشل التسليم بوضوح.","normal","/delivery"],["rider.missing_invoices","مراجعة الفواتير الناقصة","أكمل رقم الفاتورة أو صورة الريسيت إن طلبت.","normal","/delivery"]]'::jsonb
    when 'cleaning' then
      '[["cleaning.morning","Checklist صباحي","نفذ قائمة النظافة الصباحية.","high","/branch-cleaning"],["cleaning.evening","Checklist مسائي","نفذ قائمة النظافة المسائية.","high","/branch-cleaning"],["cleaning.floor","تأكيد نظافة الأرضية","راجع الأرضية ومنطقة العملاء.","normal","/branch-cleaning"],["cleaning.counter","تأكيد نظافة الكاونتر","راجع الكاونتر والأرفف.","normal","/branch-cleaning"],["cleaning.note","تسجيل أي ملاحظة","سجل أي تلف أو احتياج تنظيف.","normal","/branch-cleaning"]]'::jsonb
    else
      '[["daily.review","مراجعة مهام اليوم","راجع المطلوب حسب دورك.","high","/employee-operating-system"],["daily.complete","إغلاق المهام المكتملة","حدث حالة المهام بعد التنفيذ.","normal","/employee-operating-system"],["daily.note","تسجيل ملاحظة تشغيلية","اكتب ملاحظة عند وجود عائق.","normal","/shift-notes"]]'::jsonb
    end;

  for v_task in select value from jsonb_array_elements(v_tasks)
  loop
    insert into public.employee_daily_tasks (
      staff_id, staff_name, role, branch, task_key, task_title, task_description,
      task_date, status, priority, source, related_route, related_entity_type,
      related_entity_id, created_at, updated_at
    )
    values (
      nullif(p_staff_id, ''),
      nullif(p_staff_name, ''),
      v_role,
      nullif(p_branch, ''),
      v_task ->> 0,
      v_task ->> 1,
      v_task ->> 2,
      coalesce(p_task_date, current_date),
      'pending',
      v_task ->> 3,
      'system',
      v_task ->> 4,
      'role_profile',
      v_role,
      now(),
      now()
    )
    on conflict (coalesce(staff_id, ''), task_date, task_key) do update
      set staff_name = excluded.staff_name,
          role = excluded.role,
          branch = excluded.branch,
          task_title = excluded.task_title,
          task_description = excluded.task_description,
          priority = excluded.priority,
          related_route = excluded.related_route,
          updated_at = now();
  end loop;

  update public.employee_daily_tasks
  set status = 'late',
      updated_at = now()
  where task_date < current_date
    and status = 'pending';

  return query
    select *
    from public.employee_daily_tasks
    where task_date = coalesce(p_task_date, current_date)
      and coalesce(staff_id, '') = coalesce(p_staff_id, '')
    order by
      case priority when 'urgent' then 3 when 'high' then 2 else 1 end desc,
      created_at asc;
end;
$$;

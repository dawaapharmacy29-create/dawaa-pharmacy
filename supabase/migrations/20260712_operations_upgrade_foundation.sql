-- Operations upgrade foundation for Dawaa Pharmacy
-- Safe/idempotent objects only. Existing business tables are not dropped or rewritten.

create table if not exists public.branch_daily_tasks (
  id uuid primary key default gen_random_uuid(),
  task_date date not null,
  branch text not null,
  category text not null,
  title text not null,
  description text,
  priority text not null default 'normal',
  status text not null default 'pending',
  assigned_staff_id uuid,
  assigned_staff_name text,
  due_at timestamptz,
  evidence_url text,
  completion_note text,
  completed_at timestamptz,
  completed_by uuid,
  approved_at timestamptz,
  approved_by uuid,
  approved_by_name text,
  source_template_key text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branch_daily_tasks_status_check
    check (status in ('pending','in_progress','completed','approved','blocked','cancelled')),
  constraint branch_daily_tasks_priority_check
    check (priority in ('low','normal','high','urgent'))
);

create unique index if not exists branch_daily_tasks_unique_template_day
  on public.branch_daily_tasks(task_date, branch, source_template_key)
  where source_template_key is not null;

create index if not exists branch_daily_tasks_branch_date_idx
  on public.branch_daily_tasks(branch, task_date desc);

create index if not exists branch_daily_tasks_status_idx
  on public.branch_daily_tasks(status, due_at);

create table if not exists public.branch_daily_task_templates (
  id uuid primary key default gen_random_uuid(),
  template_key text not null unique,
  category text not null,
  title text not null,
  description text,
  priority text not null default 'normal',
  default_time time,
  applies_to_branch text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branch_daily_task_templates_priority_check
    check (priority in ('low','normal','high','urgent'))
);

insert into public.branch_daily_task_templates
  (template_key, category, title, description, priority, default_time, sort_order)
values
  ('attendance_opening', 'الحضور', 'مراجعة حضور بداية اليوم', 'مراجعة الحاضرين والمتأخرين والغياب وتوزيع المسؤوليات.', 'urgent', '09:15', 10),
  ('cleaning_opening', 'النظافة', 'اعتماد نظافة افتتاح الفرع', 'مراجعة الأرضيات والأرفف والثلاجات والواجهة ومنطقة العميل.', 'high', '09:30', 20),
  ('customer_requests', 'خدمة العملاء', 'مراجعة طلبات العملاء المعلقة', 'إغلاق طلبات أمس ومراجعة الطلبات غير المسجلة والعملاء المهمين.', 'high', '11:00', 30),
  ('customer_coding', 'العملاء', 'مراجعة تكويد العملاء الجدد', 'التأكد من الاسم والكود والهاتف والعنوان والفرع.', 'normal', '13:00', 40),
  ('pending_invoices', 'الفواتير', 'مراجعة الفواتير المعلقة', 'مراجعة الفواتير غير المرتبطة بعميل أو دكتور أو فرع.', 'high', '15:00', 50),
  ('purchases', 'المشتريات', 'مراجعة المشتريات وفواتير الشراء', 'مراجعة الموردين والفواتير والنواقص والتحويلات.', 'normal', '16:00', 60),
  ('staff_performance', 'الفريق', 'مراجعة أداء الدكاترة', 'تحديد المتحسن ومن يحتاج تدريبًا ومراجعة متوسط الفاتورة والتقييمات.', 'normal', '19:00', 70),
  ('delivery_followup', 'الدليفري', 'مراجعة أوردرات الدليفري', 'مراجعة المتأخر والفاشل والمكرر والمحتاج مطابقة.', 'high', '21:00', 80),
  ('closing_review', 'إغلاق اليوم', 'إغلاق تقرير الفرع اليومي', 'مراجعة الكاش والفواتير والطلبات والنواقص والحضور وتحديد أولويات الغد.', 'urgent', '23:30', 90)
on conflict (template_key) do update set
  category = excluded.category,
  title = excluded.title,
  description = excluded.description,
  priority = excluded.priority,
  default_time = excluded.default_time,
  sort_order = excluded.sort_order,
  active = true,
  updated_at = now();

create or replace function public.create_daily_branch_tasks(
  p_branch text,
  p_task_date date default current_date,
  p_created_by uuid default null
)
returns table(created_count integer, existing_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before integer;
  v_after integer;
begin
  if coalesce(trim(p_branch), '') = '' then
    raise exception 'branch is required';
  end if;

  select count(*) into v_before
  from public.branch_daily_tasks
  where branch = trim(p_branch)
    and task_date = p_task_date;

  insert into public.branch_daily_tasks (
    task_date, branch, category, title, description, priority,
    due_at, source_template_key, created_by
  )
  select
    p_task_date,
    trim(p_branch),
    t.category,
    t.title,
    t.description,
    t.priority,
    case
      when t.default_time is null then null
      else (p_task_date::timestamp + t.default_time) at time zone 'Africa/Cairo'
    end,
    t.template_key,
    p_created_by
  from public.branch_daily_task_templates t
  where t.active = true
    and (t.applies_to_branch is null or t.applies_to_branch = trim(p_branch))
  on conflict do nothing;

  select count(*) into v_after
  from public.branch_daily_tasks
  where branch = trim(p_branch)
    and task_date = p_task_date;

  return query select greatest(v_after - v_before, 0), v_before;
end;
$$;

create or replace function public.set_branch_daily_task_status(
  p_task_id uuid,
  p_status text,
  p_actor_id uuid default null,
  p_actor_name text default null,
  p_note text default null,
  p_evidence_url text default null
)
returns public.branch_daily_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.branch_daily_tasks;
begin
  if p_status not in ('pending','in_progress','completed','approved','blocked','cancelled') then
    raise exception 'invalid task status';
  end if;

  update public.branch_daily_tasks
  set
    status = p_status,
    completion_note = coalesce(p_note, completion_note),
    evidence_url = coalesce(p_evidence_url, evidence_url),
    completed_at = case when p_status in ('completed','approved') then coalesce(completed_at, now()) else completed_at end,
    completed_by = case when p_status in ('completed','approved') then coalesce(p_actor_id, completed_by) else completed_by end,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    approved_by = case when p_status = 'approved' then p_actor_id else approved_by end,
    approved_by_name = case when p_status = 'approved' then p_actor_name else approved_by_name end,
    updated_at = now()
  where id = p_task_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'task not found';
  end if;

  return v_row;
end;
$$;

alter table public.branch_daily_tasks enable row level security;
alter table public.branch_daily_task_templates enable row level security;

-- Authenticated users can read templates. Branch/task scoping remains enforced in the app
-- until the canonical staff-account JWT claims are available in every environment.
drop policy if exists branch_daily_task_templates_read on public.branch_daily_task_templates;
create policy branch_daily_task_templates_read
  on public.branch_daily_task_templates
  for select
  to authenticated
  using (active = true);

-- Keep task access authenticated while the UI applies the existing role/branch scope helpers.
-- Write operations should use the SECURITY DEFINER functions above.
drop policy if exists branch_daily_tasks_read on public.branch_daily_tasks;
create policy branch_daily_tasks_read
  on public.branch_daily_tasks
  for select
  to authenticated
  using (true);

grant select on public.branch_daily_task_templates to authenticated;
grant select on public.branch_daily_tasks to authenticated;
grant execute on function public.create_daily_branch_tasks(text,date,uuid) to authenticated;
grant execute on function public.set_branch_daily_task_status(uuid,text,uuid,text,text,text) to authenticated;

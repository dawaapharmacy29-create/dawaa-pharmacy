-- Dawaa Pharmacy 2027 - نظام تشغيل الصيدلية الذكي
-- يشغل هذا الملف مرة واحدة في Supabase SQL Editor بعد حفظ نسخة احتياطية.
-- لا يحذف أي جدول قديم، ويضيف طبقة مرنة فوق التطبيق الحالي.

create extension if not exists pgcrypto;

-- 1) الدورات الشهرية 26 → 25
create table if not exists public.cycles (
  id uuid primary key default gen_random_uuid(),
  cycle_key text unique not null,
  label text not null,
  start_date date not null,
  end_date date not null,
  cycle_type text default 'monthly',
  status text default 'open',
  reports_generated boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2) دورات ربع سنوية للحافز 2000 جنيه
create table if not exists public.quarter_cycles (
  id uuid primary key default gen_random_uuid(),
  quarter_key text unique not null,
  label text not null,
  start_date date not null,
  end_date date not null,
  incentive_value numeric default 2000,
  status text default 'open',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3) قواعد التقييم المرنة
create table if not exists public.evaluation_rules (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  type text not null check (type in ('penalty','reward')),
  category text not null,
  target_role text default 'الكل',
  points numeric not null default 0,
  base_points numeric not null default 0,
  repeatable boolean default true,
  max_points numeric,
  requires_approval boolean default true,
  visible_to_employee boolean default true,
  creates_task boolean default false,
  severity text default 'medium',
  active boolean default true,
  employee_message text,
  corrective_action text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

insert into public.evaluation_rules (title,type,category,target_role,points,base_points,repeatable,requires_approval,severity,employee_message)
values
('عدم متابعة عميل VIP في موعده','penalty','خدمة العملاء','الكل',25,25,true,true,'medium','تم خصم نقاط بسبب عدم الالتزام بمتابعة عميل مهم في موعده.'),
('شكوى عميل بسبب أسلوب التعامل','penalty','خدمة العملاء','الكل',40,40,true,true,'high','تم تسجيل شكوى مرتبطة بأسلوب التعامل مع العميل.'),
('فقد عميل مهم بسبب عدم المتابعة','penalty','خدمة العملاء','الكل',60,60,true,true,'high','تم تسجيل فقد أو انخفاض تعامل عميل مهم بسبب تقصير متابعة.'),
('تأخير عن الشيفت بدون إذن','penalty','التشغيل','الكل',20,20,true,true,'medium','تم تسجيل تأخير بدون إذن مسبق.'),
('غياب بدون إذن','penalty','التشغيل','الكل',80,80,true,true,'critical','تم تسجيل غياب بدون إذن.'),
('صرف راكد بدون تسجيل عميل وفاتورة','penalty','المخزون','صيدلاني',20,20,true,true,'medium','صرف الرواكد يجب أن يرتبط بعميل وكود ورقم فاتورة.'),
('تسجيل صنف لستة بدون بيانات العميل','penalty','أدوية اللستة','صيدلاني',15,15,true,true,'medium','أي صنف من اللستة لا يحتسب بدون عميل وفاتورة.'),
('خطأ دوائي مؤثر أو ترشيح غير مناسب','penalty','السلامة الدوائية','صيدلاني',100,100,true,true,'critical','خطأ دوائي أو ترشيح غير مناسب يحتاج مراجعة إدارية.'),
('إعادة عميل مهم للشراء بعد متابعة ناجحة','reward','خدمة العملاء','الكل',20,20,false,true,'positive','مكافأة استثنائية لنجاح متابعة عميل مهم.'),
('اقتراح تحسين تم تطبيقه داخل المنظومة','reward','التطوير','الكل',30,30,false,true,'positive','مكافأة استثنائية لمبادرة تطوير تم تطبيقها.'),
('تحقيق راكد صعب قبل انتهاء الصلاحية','reward','المخزون','صيدلاني',20,20,false,true,'positive','مكافأة استثنائية لتحريك راكد مهم.'),
('دورة كاملة بدون أي خصم','reward','الأداء','الكل',25,25,false,true,'positive','مكافأة استثنائية لدورة كاملة بدون خصومات.')
on conflict do nothing;

-- 4) تثبيت employee_transactions كمصدر رسمي للخصومات والمكافآت
-- إصلاح مهم: بعض نسخ قاعدة البيانات القديمة لا تحتوي عمود staff_id داخل employee_transactions
alter table if exists public.employee_transactions add column if not exists staff_id uuid;
alter table if exists public.employee_transactions add column if not exists employee_name text;
alter table if exists public.employee_transactions add column if not exists rule_id uuid;
alter table if exists public.employee_transactions add column if not exists category text;
alter table if exists public.employee_transactions add column if not exists repeat_count integer default 1;
alter table if exists public.employee_transactions add column if not exists base_points numeric;
alter table if exists public.employee_transactions add column if not exists final_points numeric;
alter table if exists public.employee_transactions add column if not exists approved_by text;
alter table if exists public.employee_transactions add column if not exists approved_at timestamptz;
alter table if exists public.employee_transactions add column if not exists employee_visible boolean default true;
alter table if exists public.employee_transactions add column if not exists corrective_action text;
alter table if exists public.employee_transactions add column if not exists status text default 'approved';

update public.employee_transactions et
set employee_name = s.name
from public.staff s
where et.staff_id = s.id
  and (et.employee_name is null or trim(et.employee_name) = '');

update public.employee_transactions
set status = 'approved'
where status is null or trim(status) = '' or status in ('active','مرفوض','rejected');

update public.employee_transactions
set base_points = coalesce(base_points, points, points_delta, 0),
    final_points = coalesce(final_points, points, points_delta, 0),
    repeat_count = coalesce(repeat_count, 1)
where base_points is null or final_points is null or repeat_count is null;

-- 5) علامات وملاحظات العميل التشغيلية
create table if not exists public.customer_flags (
  id uuid primary key default gen_random_uuid(),
  customer_id text,
  customer_code text,
  customer_name text,
  flag_key text not null,
  flag_label text not null,
  is_active boolean default true,
  notes text,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_customer_flags_code on public.customer_flags(customer_code);
create index if not exists idx_customer_flags_active on public.customer_flags(is_active);

create table if not exists public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  customer_id text,
  customer_code text,
  customer_name text,
  note text not null,
  note_type text default 'general',
  priority text default 'normal',
  visible_in_sales boolean default true,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table if exists public.customers add column if not exists notes text;
alter table if exists public.customers add column if not exists service_notes text;
alter table if exists public.customers add column if not exists customer_flags jsonb default '[]'::jsonb;
alter table if exists public.customer_analysis add column if not exists notes text;
alter table if exists public.customer_analysis add column if not exists service_notes text;
alter table if exists public.customer_analysis add column if not exists customer_flags jsonb default '[]'::jsonb;

-- 6) مهام وتنبيهات موحدة
create table if not exists public.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  type text,
  category text,
  priority text default 'عادي',
  status text default 'open',
  assigned_to uuid,
  assigned_to_name text,
  related_type text,
  related_id text,
  customer_code text,
  staff_id uuid,
  due_date date,
  month_cycle text,
  completed_at timestamptz,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table if exists public.notifications add column if not exists route text;
alter table if exists public.notifications add column if not exists priority text default 'عادي';
alter table if exists public.notifications add column if not exists target_type text;
alter table if exists public.notifications add column if not exists target_id text;

-- 7) الحافز الربع سنوي
create table if not exists public.quarterly_performance_reviews (
  id uuid primary key default gen_random_uuid(),
  quarter_key text not null,
  staff_id uuid references public.staff(id) on delete set null,
  staff_name text,
  branch text,
  total_sales numeric default 0,
  invoice_count integer default 0,
  avg_invoice numeric default 0,
  unique_customers integer default 0,
  top_customer_name text,
  top_customer_value numeric default 0,
  sales_score numeric default 0,
  avg_invoice_score numeric default 0,
  customer_score numeric default 0,
  list_score numeric default 0,
  stagnant_score numeric default 0,
  data_quality_score numeric default 0,
  final_score numeric default 0,
  incentive_value numeric default 0,
  status text default 'draft',
  manager_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(quarter_key, staff_id)
);

create table if not exists public.quarterly_performance_items (
  id uuid primary key default gen_random_uuid(),
  review_id uuid references public.quarterly_performance_reviews(id) on delete cascade,
  pillar_key text,
  pillar_label text,
  max_score numeric,
  score numeric,
  details jsonb default '{}'::jsonb,
  notes text,
  created_at timestamptz default now()
);

-- 8) أدوية اللستة كتارجت شهري/ربع سنوي
create table if not exists public.doctor_incentive_targets (
  id uuid primary key default gen_random_uuid(),
  cycle_key text,
  quarter_key text,
  staff_id uuid references public.staff(id) on delete set null,
  staff_name text,
  medicine_name text not null,
  medicine_code text,
  category text,
  target_quantity numeric default 0,
  unit_incentive numeric default 0,
  min_quantity numeric default 0,
  status text default 'active',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.doctor_incentive_sales (
  id uuid primary key default gen_random_uuid(),
  target_id uuid references public.doctor_incentive_targets(id) on delete set null,
  staff_id uuid references public.staff(id) on delete set null,
  staff_name text,
  medicine_name text,
  quantity numeric default 0,
  customer_id text,
  customer_code text,
  customer_name text,
  customer_phone text,
  invoice_no text,
  invoice_date date,
  sale_value numeric default 0,
  month_cycle text,
  quarter_key text,
  status text default 'approved',
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 9) تحسين صرف الرواكد وتخفيف قيود created_by التي سببت تعارضات في الاختبار
alter table if exists public.stagnant_medicine_dispenses add column if not exists customer_id text;
alter table if exists public.stagnant_medicine_dispenses add column if not exists customer_name text;
alter table if exists public.stagnant_medicine_dispenses add column if not exists customer_code text;
alter table if exists public.stagnant_medicine_dispenses add column if not exists customer_phone text;
alter table if exists public.stagnant_medicine_dispenses add column if not exists invoice_no text;
alter table if exists public.stagnant_medicine_dispenses add column if not exists notes text;
alter table if exists public.stagnant_medicine_dispenses drop constraint if exists stagnant_medicine_dispenses_created_by_fkey;

-- 10) فهارس للسرعة
create index if not exists idx_sales_invoices_invoice_date on public.sales_invoices(invoice_date);
create index if not exists idx_sales_invoices_customer_code on public.sales_invoices(customer_code);
create index if not exists idx_employee_transactions_staff_id on public.employee_transactions(staff_id);
create index if not exists idx_employee_transactions_status on public.employee_transactions(status);
create index if not exists idx_tasks_status_due on public.tasks(status, due_date);
create index if not exists idx_doctor_targets_staff on public.doctor_incentive_targets(staff_id);
create index if not exists idx_doctor_sales_staff on public.doctor_incentive_sales(staff_id);

-- 11) RLS مبسط للتطبيق الداخلي الحالي
alter table public.cycles enable row level security;
alter table public.quarter_cycles enable row level security;
alter table public.evaluation_rules enable row level security;
alter table public.customer_flags enable row level security;
alter table public.customer_notes enable row level security;
alter table public.tasks enable row level security;
alter table public.quarterly_performance_reviews enable row level security;
alter table public.quarterly_performance_items enable row level security;
alter table public.doctor_incentive_targets enable row level security;
alter table public.doctor_incentive_sales enable row level security;

do $$
declare t text;
begin
  foreach t in array array['cycles','quarter_cycles','evaluation_rules','customer_flags','customer_notes','tasks','quarterly_performance_reviews','quarterly_performance_items','doctor_incentive_targets','doctor_incentive_sales'] loop
    execute format('drop policy if exists "Allow app access %I" on public.%I', t, t);
    execute format('create policy "Allow app access %I" on public.%I for all to anon, authenticated using (true) with check (true)', t, t);
  end loop;
end $$;


-- 12) تثبيت روابط الموظفين والحسابات وسجل الأنشطة للنسخة التشغيلية
alter table if exists public.staff_accounts add column if not exists staff_id uuid;
alter table if exists public.staff_accounts add column if not exists username text;
alter table if exists public.staff_accounts add column if not exists password text;
alter table if exists public.staff_accounts add column if not exists role text;
alter table if exists public.staff_accounts add column if not exists branch text;
alter table if exists public.staff_accounts add column if not exists is_active boolean default true;
alter table if exists public.staff_accounts add column if not exists permissions jsonb default '{}'::jsonb;
alter table if exists public.staff_accounts add column if not exists updated_at timestamptz default now();

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  user_name text,
  user_role text,
  action text,
  module text,
  details jsonb,
  branch_name text,
  target_type text,
  target_id text,
  created_at timestamptz default now()
);
alter table public.activity_logs enable row level security;
drop policy if exists "Allow app activity_logs" on public.activity_logs;
create policy "Allow app activity_logs" on public.activity_logs for all to anon, authenticated using (true) with check (true);

create index if not exists idx_activity_logs_created_at on public.activity_logs(created_at desc);
create index if not exists idx_activity_logs_target on public.activity_logs(target_type, target_id);

-- canonical notes: employee_transactions is the official ledger; old point tables remain archived/read-only until manual cleanup.

notify pgrst, 'reload schema';

select 'Dawaa Pharmacy 2027 schema ready' as status;

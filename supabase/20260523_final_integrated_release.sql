-- Dawaa Pharmacy 2027 - Final Integrated Release Patch
-- يشغّل بأمان بعد ملفات 2027 السابقة. لا يحذف بيانات، ويضيف الجداول/الأعمدة المطلوبة للنسخة النهائية.

create extension if not exists pgcrypto;

-- 1) Customer requests workflow
create table if not exists public.customer_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id text,
  customer_code text,
  customer_name text,
  customer_phone text,
  branch text,
  medicine_name text not null,
  medicine_image_url text,
  quantity numeric default 1,
  urgency text default 'normal',
  status text default 'new',
  request_type text default 'missing_medicine',
  needs_customer_confirmation boolean default false,
  is_expensive_or_special boolean default false,
  doctor_id uuid,
  doctor_name text,
  purchasing_assignee text,
  doctor_notes text,
  supplier_hint text,
  purchasing_notes text,
  customer_confirmation_status text,
  contact_summary text,
  expected_arrival_date date,
  closed_at timestamptz,
  created_by text,
  created_by_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.customer_requests add column if not exists customer_id text;
alter table public.customer_requests add column if not exists customer_code text;
alter table public.customer_requests add column if not exists customer_name text;
alter table public.customer_requests add column if not exists customer_phone text;
alter table public.customer_requests add column if not exists branch text;
alter table public.customer_requests add column if not exists medicine_name text;
alter table public.customer_requests add column if not exists medicine_image_url text;
alter table public.customer_requests add column if not exists quantity numeric default 1;
alter table public.customer_requests add column if not exists urgency text default 'normal';
alter table public.customer_requests add column if not exists status text default 'new';
alter table public.customer_requests add column if not exists request_type text default 'missing_medicine';
alter table public.customer_requests add column if not exists needs_customer_confirmation boolean default false;
alter table public.customer_requests add column if not exists is_expensive_or_special boolean default false;
alter table public.customer_requests add column if not exists doctor_id uuid;
alter table public.customer_requests add column if not exists doctor_name text;
alter table public.customer_requests add column if not exists purchasing_assignee text;
alter table public.customer_requests add column if not exists doctor_notes text;
alter table public.customer_requests add column if not exists supplier_hint text;
alter table public.customer_requests add column if not exists purchasing_notes text;
alter table public.customer_requests add column if not exists customer_confirmation_status text;
alter table public.customer_requests add column if not exists contact_summary text;
alter table public.customer_requests add column if not exists expected_arrival_date date;
alter table public.customer_requests add column if not exists closed_at timestamptz;
alter table public.customer_requests add column if not exists created_by text;
alter table public.customer_requests add column if not exists created_by_name text;
alter table public.customer_requests add column if not exists created_at timestamptz default now();
alter table public.customer_requests add column if not exists updated_at timestamptz default now();

create table if not exists public.customer_request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid,
  old_status text,
  new_status text,
  action text,
  notes text,
  created_by text,
  created_by_name text,
  created_at timestamptz default now()
);

alter table public.customer_request_events add column if not exists request_id uuid;
alter table public.customer_request_events add column if not exists old_status text;
alter table public.customer_request_events add column if not exists new_status text;
alter table public.customer_request_events add column if not exists action text;
alter table public.customer_request_events add column if not exists notes text;
alter table public.customer_request_events add column if not exists created_by text;
alter table public.customer_request_events add column if not exists created_by_name text;
alter table public.customer_request_events add column if not exists created_at timestamptz default now();

-- 2) Customer service timeline compatibility
alter table public.daily_followups add column if not exists customer_code text;
alter table public.daily_followups add column if not exists customer_phone text;
alter table public.daily_followups add column if not exists customer_name text;
alter table public.daily_followups add column if not exists contact_method text;
alter table public.daily_followups add column if not exists followup_type text;
alter table public.daily_followups add column if not exists followup_summary text;
alter table public.daily_followups add column if not exists followup_result text;
alter table public.daily_followups add column if not exists next_followup_date date;
alter table public.daily_followups add column if not exists request_type text;
alter table public.daily_followups add column if not exists request_details text;
alter table public.daily_followups add column if not exists request_status text;
alter table public.daily_followups add column if not exists purchase_after_followup boolean default false;
alter table public.daily_followups add column if not exists purchase_amount numeric default 0;
alter table public.daily_followups add column if not exists purchase_invoice_no text;
alter table public.daily_followups add column if not exists closed_at timestamptz;
alter table public.daily_followups add column if not exists closed_by text;

-- 3) Evaluation rules compatibility
create table if not exists public.evaluation_rules (
  id uuid primary key default gen_random_uuid(),
  rule_key text,
  title text,
  description text,
  type text,
  category text,
  points numeric default 0,
  role_scope text,
  applies_to_role text,
  severity text default 'normal',
  is_repeatable boolean default true,
  repeat_multiplier boolean default true,
  requires_approval boolean default false,
  is_active boolean default true,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.evaluation_rules add column if not exists rule_key text;
alter table public.evaluation_rules add column if not exists title text;
alter table public.evaluation_rules add column if not exists description text;
alter table public.evaluation_rules add column if not exists type text;
alter table public.evaluation_rules add column if not exists category text;
alter table public.evaluation_rules add column if not exists points numeric default 0;
alter table public.evaluation_rules add column if not exists role_scope text;
alter table public.evaluation_rules add column if not exists applies_to_role text;
alter table public.evaluation_rules add column if not exists severity text default 'normal';
alter table public.evaluation_rules add column if not exists is_repeatable boolean default true;
alter table public.evaluation_rules add column if not exists repeat_multiplier boolean default true;
alter table public.evaluation_rules add column if not exists requires_approval boolean default false;
alter table public.evaluation_rules add column if not exists is_active boolean default true;
alter table public.evaluation_rules add column if not exists active boolean default true;
alter table public.evaluation_rules add column if not exists updated_at timestamptz default now();

update public.evaluation_rules set rule_key = 'legacy_' || id::text where rule_key is null or trim(rule_key) = '';
drop index if exists public.evaluation_rules_rule_key_unique;
create unique index if not exists evaluation_rules_rule_key_unique on public.evaluation_rules(rule_key);

insert into public.evaluation_rules (rule_key, title, description, type, category, points, applies_to_role, is_repeatable, requires_approval, is_active, active, created_at, updated_at)
values
('CUSTOMER_REQUEST_FULL_DATA', 'تسجيل طلب عميل كامل البيانات', 'تسجيل طلب صنف غير متوفر ببيانات العميل والصنف والكمية والملاحظات بوضوح.', 'reward', 'طلبات العملاء', 5, 'pharmacist', true, false, true, true, now(), now()),
('CUSTOMER_REQUEST_NEGLECT', 'تجاهل طلب عميل عاجل', 'ترك طلب عميل عاجل بدون متابعة أو تحديث حالة داخل نفس اليوم.', 'penalty', 'طلبات العملاء', 15, 'customer_service', true, false, true, true, now(), now()),
('EXPENSIVE_REQUEST_WITHOUT_CONFIRMATION', 'توفير صنف غالي بدون تأكيد العميل', 'شراء أو توفير صنف غالي/خاص بدون تسجيل تأكيد العميل أولًا.', 'penalty', 'طلبات العملاء', 20, 'purchasing', true, false, true, true, now(), now()),
('FOLLOWUP_CLOSED_WITH_PURCHASE', 'متابعة عميل أدت لشراء', 'إغلاق متابعة ناجحة أثبتت عودة العميل للشراء بعد التواصل.', 'reward', 'خدمة العملاء', 10, 'customer_service', true, false, true, true, now(), now())
on conflict (rule_key) do update set
  title = excluded.title,
  description = excluded.description,
  type = excluded.type,
  category = excluded.category,
  points = excluded.points,
  updated_at = now();

-- 4) Activity logs official table
create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  action text,
  module text,
  details text,
  user_name text,
  target_type text,
  target_id text,
  branch text,
  source text,
  created_at timestamptz default now()
);

alter table public.activity_logs add column if not exists action text;
alter table public.activity_logs add column if not exists module text;
alter table public.activity_logs add column if not exists details text;
alter table public.activity_logs add column if not exists user_name text;
alter table public.activity_logs add column if not exists target_type text;
alter table public.activity_logs add column if not exists target_id text;
alter table public.activity_logs add column if not exists branch text;
alter table public.activity_logs add column if not exists source text;
alter table public.activity_logs add column if not exists created_at timestamptz default now();

-- 5) Indexes
create index if not exists idx_customer_requests_status on public.customer_requests(status);
create index if not exists idx_customer_requests_customer_code on public.customer_requests(customer_code);
create index if not exists idx_customer_requests_phone on public.customer_requests(customer_phone);
create index if not exists idx_customer_requests_branch on public.customer_requests(branch);
create index if not exists idx_customer_requests_created_at on public.customer_requests(created_at desc);
create index if not exists idx_customer_request_events_request on public.customer_request_events(request_id, created_at desc);
create index if not exists idx_daily_followups_customer_code on public.daily_followups(customer_code);
create index if not exists idx_daily_followups_customer_phone on public.daily_followups(customer_phone);
create index if not exists idx_daily_followups_next_date on public.daily_followups(next_followup_date);
create index if not exists idx_activity_logs_created_at on public.activity_logs(created_at desc);

notify pgrst, 'reload schema';
select 'Dawaa Pharmacy 2027 final integrated release schema ready' as status;

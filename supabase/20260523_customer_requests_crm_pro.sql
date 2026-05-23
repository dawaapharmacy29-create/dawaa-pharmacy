-- Dawaa Pharmacy 2027 - Customer Requests CRM Pro
-- شغّل هذا الملف بعد ملفات Dawaa Pharmacy 2027 الأساسية.

create extension if not exists pgcrypto;

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

create index if not exists idx_customer_requests_status on public.customer_requests(status);
create index if not exists idx_customer_requests_customer_code on public.customer_requests(customer_code);
create index if not exists idx_customer_requests_phone on public.customer_requests(customer_phone);
create index if not exists idx_customer_requests_branch on public.customer_requests(branch);
create index if not exists idx_customer_requests_doctor on public.customer_requests(doctor_name);
create index if not exists idx_customer_requests_created_at on public.customer_requests(created_at desc);
create index if not exists idx_customer_request_events_request on public.customer_request_events(request_id, created_at desc);

-- إضافة بنود تقييم مرنة إن كان جدول evaluation_rules بنفس أعمدة 2027 موجودًا
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='evaluation_rules')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='evaluation_rules' and column_name='rule_key')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='evaluation_rules' and column_name='title')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='evaluation_rules' and column_name='category')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='evaluation_rules' and column_name='type')
     and exists (select 1 from information_schema.columns where table_schema='public' and table_name='evaluation_rules' and column_name='points') then

    if not exists (select 1 from public.evaluation_rules where rule_key='CUSTOMER_REQUEST_FULL_DATA') then
      insert into public.evaluation_rules (rule_key, title, category, type, points, applies_to_role, doubles_on_repeat, active, description)
      values ('CUSTOMER_REQUEST_FULL_DATA', 'تسجيل طلب عميل كامل البيانات', 'طلبات العملاء', 'reward', 5, 'pharmacist', false, true, 'مكافأة عند تسجيل طلب صنف غير متوفر ببيانات العميل والصنف والكمية بوضوح.');
    end if;

    if not exists (select 1 from public.evaluation_rules where rule_key='CUSTOMER_REQUEST_NEGLECT') then
      insert into public.evaluation_rules (rule_key, title, category, type, points, applies_to_role, doubles_on_repeat, active, description)
      values ('CUSTOMER_REQUEST_NEGLECT', 'تجاهل طلب عميل عاجل', 'طلبات العملاء', 'penalty', 15, 'customer_service', true, true, 'خصم عند ترك طلب عميل عاجل بدون متابعة أو تحديث حالة داخل نفس اليوم.');
    end if;

    if not exists (select 1 from public.evaluation_rules where rule_key='EXPENSIVE_REQUEST_WITHOUT_CONFIRMATION') then
      insert into public.evaluation_rules (rule_key, title, category, type, points, applies_to_role, doubles_on_repeat, active, description)
      values ('EXPENSIVE_REQUEST_WITHOUT_CONFIRMATION', 'توفير صنف غالي بدون تأكيد العميل', 'طلبات العملاء', 'penalty', 20, 'purchasing', true, true, 'خصم عند شراء/توفير صنف غالي أو خاص بدون تسجيل تأكيد العميل أولاً.');
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
select 'Customer Requests CRM Pro schema ready' as status;

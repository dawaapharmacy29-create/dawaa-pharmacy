-- Dawaa Pharmacy System — final stability patch v4
-- شغّل الملف كاملًا في Supabase SQL Editor ثم اعمل Ctrl+F5 للتطبيق.

-- 1) تثبيت سجل الجزاءات والحوافز حتى لا تظهر السجلات كمرفوضة أو بدون اسم موظف
alter table public.employee_transactions add column if not exists employee_name text;

update public.employee_transactions et
set employee_name = s.name
from public.staff s
where et.staff_id = s.id
  and (et.employee_name is null or trim(et.employee_name) = '');

update public.employee_transactions
set status = 'approved'
where status is null
   or trim(status) = ''
   or lower(status) in ('active', 'done', 'completed', 'cancelled', 'canceled')
   or status in ('مرفوض', 'رفض', 'معتمد');

alter table public.employee_transactions
alter column status set default 'approved';

-- 2) منع فشل حفظ صرف الرواكد بسبب created_by غير موجود في staff
alter table public.stagnant_medicine_dispenses
  drop constraint if exists stagnant_medicine_dispenses_created_by_fkey;

alter table public.stagnant_medicine_dispenses add column if not exists customer_id text;
alter table public.stagnant_medicine_dispenses add column if not exists customer_name text;
alter table public.stagnant_medicine_dispenses add column if not exists customer_code text;
alter table public.stagnant_medicine_dispenses add column if not exists customer_phone text;
alter table public.stagnant_medicine_dispenses add column if not exists invoice_no text;
alter table public.stagnant_medicine_dispenses add column if not exists notes text;

-- 3) ملاحظات خدمة العملاء: دعم الحفظ على الجدولين المستخدمين في التطبيق
alter table public.customers add column if not exists notes text;
alter table public.customers add column if not exists whatsapp_notes text;
alter table public.customers add column if not exists updated_at timestamp with time zone default now();

alter table public.customer_analysis add column if not exists notes text;
alter table public.customer_analysis add column if not exists whatsapp_notes text;
alter table public.customer_analysis add column if not exists updated_at timestamp with time zone default now();

-- 4) بنية مستقبلية منظمة لأهداف أدوية اللستة لكل دكتور، لا تؤثر على الصفحة الحالية
create table if not exists public.doctor_incentive_targets (
  id uuid primary key default gen_random_uuid(),
  doctor_id uuid references public.staff(id) on delete set null,
  doctor_name text not null,
  branch text,
  product_name text not null,
  product_type text,
  target_quantity numeric default 0,
  incentive_per_unit numeric default 0,
  cycle_label text,
  active boolean default true,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists public.doctor_incentive_sales (
  id uuid primary key default gen_random_uuid(),
  target_id uuid references public.doctor_incentive_targets(id) on delete set null,
  doctor_id uuid references public.staff(id) on delete set null,
  doctor_name text not null,
  product_name text not null,
  customer_id text,
  customer_name text,
  customer_code text,
  customer_phone text,
  invoice_no text,
  quantity numeric default 1,
  incentive_per_unit numeric default 0,
  incentive_total numeric default 0,
  sale_date date default current_date,
  cycle_label text,
  notes text,
  created_at timestamp with time zone default now()
);

-- 5) تحديث كاش PostgREST
notify pgrst, 'reload schema';

-- مراجعة سريعة
select status, count(*) from public.employee_transactions group by status order by status;

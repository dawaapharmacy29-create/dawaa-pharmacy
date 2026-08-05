-- اختياري: شغّل يدويًا من Supabase SQL Editor عند تفعيل متابعة إعادة الصرف.
create table if not exists public.customer_medication_cycles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid null,
  customer_name text not null,
  phone text not null,
  medication_name text not null,
  cycle_days int not null default 30 check (cycle_days > 0),
  last_purchase_date date,
  next_refill_date date,
  reminder_days_before int not null default 5 check (reminder_days_before >= 0),
  status text not null default 'active',
  notes text,
  branch text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

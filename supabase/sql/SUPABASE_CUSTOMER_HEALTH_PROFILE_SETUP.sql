-- اختياري: شغّل يدويًا من Supabase SQL Editor عند تفعيل البطاقة الصحية.
create table if not exists public.customer_health_profiles (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique,
  chronic_conditions text[] not null default '{}',
  regular_medications text[] not null default '{}',
  allergies text[] not null default '{}',
  pharmacist_notes text,
  important_warnings text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

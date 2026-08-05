-- اختياري: شغّل يدويًا من Supabase SQL Editor عند تفعيل الإدخال اليدوي.
create table if not exists public.expiry_discount_items (
  id uuid primary key default gen_random_uuid(),
  medicine_name text not null,
  branch text,
  quantity numeric not null default 1 check (quantity >= 0),
  expiry_date date not null,
  suggested_discount numeric not null default 0 check (suggested_discount between 0 and 100),
  status text not null default 'new',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

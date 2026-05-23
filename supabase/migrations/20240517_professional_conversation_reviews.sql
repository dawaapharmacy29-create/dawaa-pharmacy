create extension if not exists "pgcrypto";

create table if not exists public.conversation_sales_reviews (
  id uuid primary key default gen_random_uuid(),
  reviewer_id uuid,
  reviewer_name text,
  reviewer_role text,
  staff_id uuid,
  staff_name text,
  staff_role text,
  branch text,
  customer_id text,
  customer_name text,
  customer_code text,
  customer_phone text,
  evaluation_kind text,
  invoice_number text,
  invoice_time timestamp,
  evaluation_reason text,
  base_score numeric default 100,
  positive_points numeric default 0,
  negative_points numeric default 0,
  severe_error_points numeric default 0,
  total_score numeric,
  final_score numeric,
  point_impact numeric default 0,
  doctor_points_impact numeric default 0,
  impact_status text default 'pending',
  conversation_level text,
  top_positive_reason text,
  top_deduction_reason text,
  forgotten_customer boolean default false,
  missed_sale_opportunity boolean default false,
  has_critical_error boolean default false,
  repeated_error_type text,
  repeat_count integer default 0,
  repeat_multiplier numeric default 1,
  month_cycle text,
  raw_scores jsonb default '{}'::jsonb,
  has_complaint boolean default false,
  has_medical_error boolean default false,
  has_invoice_error boolean default false,
  reviewer_notes text,
  training_recommendation text,
  reviewed_at timestamptz default now(),
  created_at timestamptz default now()
);

alter table public.conversation_sales_reviews
  add column if not exists reviewer_id uuid,
  add column if not exists reviewer_name text,
  add column if not exists reviewer_role text,
  add column if not exists staff_id uuid,
  add column if not exists staff_name text,
  add column if not exists staff_role text,
  add column if not exists branch text,
  add column if not exists customer_id text,
  add column if not exists customer_name text,
  add column if not exists customer_code text,
  add column if not exists customer_phone text,
  add column if not exists evaluation_kind text,
  add column if not exists invoice_number text,
  add column if not exists invoice_time timestamp,
  add column if not exists evaluation_reason text,
  add column if not exists base_score numeric default 100,
  add column if not exists positive_points numeric default 0,
  add column if not exists negative_points numeric default 0,
  add column if not exists severe_error_points numeric default 0,
  add column if not exists total_score numeric,
  add column if not exists final_score numeric,
  add column if not exists point_impact numeric default 0,
  add column if not exists doctor_points_impact numeric default 0,
  add column if not exists impact_status text default 'pending',
  add column if not exists conversation_level text,
  add column if not exists top_positive_reason text,
  add column if not exists top_deduction_reason text,
  add column if not exists forgotten_customer boolean default false,
  add column if not exists missed_sale_opportunity boolean default false,
  add column if not exists has_critical_error boolean default false,
  add column if not exists repeated_error_type text,
  add column if not exists repeat_count integer default 0,
  add column if not exists repeat_multiplier numeric default 1,
  add column if not exists month_cycle text,
  add column if not exists raw_scores jsonb default '{}'::jsonb,
  add column if not exists has_complaint boolean default false,
  add column if not exists has_medical_error boolean default false,
  add column if not exists has_invoice_error boolean default false,
  add column if not exists reviewer_notes text,
  add column if not exists training_recommendation text,
  add column if not exists reviewed_at timestamptz default now(),
  add column if not exists created_at timestamptz default now();

create index if not exists conversation_sales_reviews_staff_idx
  on public.conversation_sales_reviews (staff_id, created_at desc);

create index if not exists conversation_sales_reviews_staff_name_idx
  on public.conversation_sales_reviews (staff_name, created_at desc);

create index if not exists conversation_sales_reviews_reviewer_idx
  on public.conversation_sales_reviews (reviewer_id, created_at desc);

create index if not exists conversation_sales_reviews_cycle_idx
  on public.conversation_sales_reviews (month_cycle, branch);

alter table public.conversation_sales_reviews enable row level security;

drop policy if exists "Allow anon read conversation sales reviews" on public.conversation_sales_reviews;
drop policy if exists "Allow anon insert conversation sales reviews" on public.conversation_sales_reviews;
drop policy if exists "Allow anon update conversation sales reviews" on public.conversation_sales_reviews;
drop policy if exists "Allow anon read conversation reviews" on public.conversation_sales_reviews;
drop policy if exists "Allow anon insert conversation reviews" on public.conversation_sales_reviews;
drop policy if exists "Allow anon update conversation reviews" on public.conversation_sales_reviews;

create policy "Allow anon read conversation sales reviews"
on public.conversation_sales_reviews
for select
to anon
using (true);

create policy "Allow anon insert conversation sales reviews"
on public.conversation_sales_reviews
for insert
to anon
with check (true);

create policy "Allow anon update conversation sales reviews"
on public.conversation_sales_reviews
for update
to anon
using (true)
with check (true);

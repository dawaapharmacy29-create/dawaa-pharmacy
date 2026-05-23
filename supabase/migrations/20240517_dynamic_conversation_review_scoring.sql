create extension if not exists "pgcrypto";

alter table public.conversation_sales_reviews
  add column if not exists doctor_id uuid,
  add column if not exists branch_id uuid,
  add column if not exists conversation_date timestamptz,
  add column if not exists conversation_type text,
  add column if not exists level text,
  add column if not exists base_points_impact numeric default 0,
  add column if not exists extra_penalty_points numeric default 0,
  add column if not exists total_applicable_items integer default 0,
  add column if not exists total_not_applicable_items integer default 0,
  add column if not exists total_applicable_points numeric default 0,
  add column if not exists earned_points numeric default 0,
  add column if not exists main_positive_reason text,
  add column if not exists main_negative_reason text,
  add column if not exists review_items jsonb default '[]'::jsonb,
  add column if not exists first_customer_message_at timestamptz,
  add column if not exists first_staff_reply_at timestamptz,
  add column if not exists first_response_minutes integer,
  add column if not exists response_speed_score numeric,
  add column if not exists greeting_score numeric,
  add column if not exists greeting_message_used text,
  add column if not exists doctor_name_used_in_greeting boolean default false,
  add column if not exists doctor_name_used boolean default false,
  add column if not exists doctor_name_score numeric,
  add column if not exists customer_name_used boolean default false,
  add column if not exists customer_name_score numeric,
  add column if not exists tone_language_score numeric,
  add column if not exists bad_tone_flag boolean default false,
  add column if not exists severe_bad_tone_flag boolean default false,
  add column if not exists understanding_score numeric,
  add column if not exists rushed_response_flag boolean default false,
  add column if not exists misunderstood_customer_flag boolean default false,
  add column if not exists follow_up_promised boolean default false,
  add column if not exists follow_up_delay_minutes integer,
  add column if not exists follow_up_score numeric,
  add column if not exists consultation_quality_score numeric,
  add column if not exists dosage_explanation_score numeric,
  add column if not exists alternative_handling_score numeric,
  add column if not exists bad_alternative_flag boolean default false,
  add column if not exists sales_quality_score numeric,
  add column if not exists upsell_cross_sell_score numeric,
  add column if not exists successful_cross_sell boolean default false,
  add column if not exists complaint_handling_score numeric,
  add column if not exists handled_angry_customer_well boolean default false,
  add column if not exists excellent_case boolean default false,
  add column if not exists order_confirmation_score numeric,
  add column if not exists has_delivery_issue boolean default false,
  add column if not exists missed_sales_opportunity boolean default false,
  add column if not exists closing_message_score numeric,
  add column if not exists closing_message_used boolean default false,
  add column if not exists updated_at timestamptz default now();

create index if not exists conversation_sales_reviews_doctor_cycle_idx
  on public.conversation_sales_reviews (doctor_id, month_cycle, created_at desc);

create index if not exists conversation_sales_reviews_staff_cycle_idx
  on public.conversation_sales_reviews (staff_id, month_cycle, created_at desc);

create index if not exists conversation_sales_reviews_source_date_idx
  on public.conversation_sales_reviews (conversation_date desc);

create table if not exists public.point_records (
  id uuid primary key default gen_random_uuid(),
  employee_id text,
  employee_name text not null,
  type text not null,
  points numeric not null default 0,
  reason text,
  manager_note text,
  created_by text,
  branch text,
  source_type text,
  source_id text,
  points_delta numeric,
  status text default 'approved',
  month_cycle text,
  created_by_id text,
  created_by_name text,
  created_by_role text,
  created_at timestamptz default now()
);

alter table if exists public.point_records
  add column if not exists source_type text,
  add column if not exists source_id text,
  add column if not exists points_delta numeric,
  add column if not exists status text default 'approved',
  add column if not exists month_cycle text,
  add column if not exists created_by_id text,
  add column if not exists created_by_name text,
  add column if not exists created_by_role text;

create index if not exists point_records_employee_cycle_idx
  on public.point_records (employee_id, month_cycle, created_at desc);

create index if not exists point_records_source_idx
  on public.point_records (source_type, source_id);

create table if not exists public.points_transactions (
  id uuid primary key default gen_random_uuid(),
  employee_id text,
  employee_name text not null,
  branch text,
  category text,
  source_type text,
  source_id text,
  points numeric not null default 0,
  points_delta numeric,
  status text default 'pending',
  reason text,
  month_cycle text,
  created_at timestamptz default now()
);

alter table if exists public.points_transactions
  add column if not exists employee_id text,
  add column if not exists points_delta numeric,
  add column if not exists month_cycle text;

create index if not exists points_transactions_employee_cycle_idx
  on public.points_transactions (employee_id, month_cycle);

alter table public.point_records enable row level security;
alter table public.points_transactions enable row level security;

drop policy if exists "Allow anon read point records" on public.point_records;
drop policy if exists "Allow anon insert point records" on public.point_records;
drop policy if exists "Allow anon update point records" on public.point_records;

create policy "Allow anon read point records"
on public.point_records
for select
to anon
using (true);

create policy "Allow anon insert point records"
on public.point_records
for insert
to anon
with check (true);

create policy "Allow anon update point records"
on public.point_records
for update
to anon
using (true)
with check (true);

drop policy if exists "Allow anon read points transactions" on public.points_transactions;
drop policy if exists "Allow anon insert points transactions" on public.points_transactions;

create policy "Allow anon read points transactions"
on public.points_transactions
for select
to anon
using (true);

create policy "Allow anon insert points transactions"
on public.points_transactions
for insert
to anon
with check (true);

create or replace function public.set_conversation_reviews_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_conversation_sales_reviews_updated_at on public.conversation_sales_reviews;

create trigger set_conversation_sales_reviews_updated_at
before update on public.conversation_sales_reviews
for each row execute function public.set_conversation_reviews_updated_at();

alter table public.conversation_sales_reviews enable row level security;

drop policy if exists "Allow anon read conversation sales reviews" on public.conversation_sales_reviews;
drop policy if exists "Allow anon insert conversation sales reviews" on public.conversation_sales_reviews;
drop policy if exists "Allow anon update conversation sales reviews" on public.conversation_sales_reviews;

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

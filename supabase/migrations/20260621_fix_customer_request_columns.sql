-- Fix for existing customer coding/followup tables that may have been created earlier with fewer columns.
-- Run this safely before/after 20260621_customer_coding_followup_and_staff_seed.sql.

create extension if not exists pgcrypto;

create table if not exists public.customer_coding_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table if exists public.customer_coding_requests add column if not exists customer_name text;
alter table if exists public.customer_coding_requests add column if not exists customer_phone text;
alter table if exists public.customer_coding_requests add column if not exists customer_code text;
alter table if exists public.customer_coding_requests add column if not exists customer_address text;
alter table if exists public.customer_coding_requests add column if not exists customer_notes text;
alter table if exists public.customer_coding_requests add column if not exists branch_name text;
alter table if exists public.customer_coding_requests add column if not exists status text default 'pending';
alter table if exists public.customer_coding_requests add column if not exists created_customer_id uuid;
alter table if exists public.customer_coding_requests add column if not exists created_by uuid;
alter table if exists public.customer_coding_requests add column if not exists created_by_name text;
alter table if exists public.customer_coding_requests add column if not exists updated_at timestamptz default now();

create table if not exists public.quick_followup_requests (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table if exists public.quick_followup_requests add column if not exists customer_id uuid;
alter table if exists public.quick_followup_requests add column if not exists customer_code text;
alter table if exists public.quick_followup_requests add column if not exists customer_name text;
alter table if exists public.quick_followup_requests add column if not exists customer_phone text;
alter table if exists public.quick_followup_requests add column if not exists branch_name text;
alter table if exists public.quick_followup_requests add column if not exists followup_summary text;
alter table if exists public.quick_followup_requests add column if not exists priority text default 'مهم';
alter table if exists public.quick_followup_requests add column if not exists status text default 'pending';
alter table if exists public.quick_followup_requests add column if not exists assigned_to text;
alter table if exists public.quick_followup_requests add column if not exists created_by uuid;
alter table if exists public.quick_followup_requests add column if not exists created_by_name text;
alter table if exists public.quick_followup_requests add column if not exists updated_at timestamptz default now();

create index if not exists idx_customer_coding_requests_created on public.customer_coding_requests(created_at desc);
create index if not exists idx_customer_coding_requests_phone on public.customer_coding_requests(customer_phone);
create index if not exists idx_quick_followup_requests_status_created on public.quick_followup_requests(status, created_at desc);
create index if not exists idx_quick_followup_requests_customer_code on public.quick_followup_requests(customer_code);

alter table public.customer_coding_requests enable row level security;
alter table public.quick_followup_requests enable row level security;

do $$ begin
  create policy "customer_coding_requests_all_authenticated" on public.customer_coding_requests for all using (true) with check (true);
exception when duplicate_object then null; end $$;

do $$ begin
  create policy "quick_followup_requests_all_authenticated" on public.quick_followup_requests for all using (true) with check (true);
exception when duplicate_object then null; end $$;

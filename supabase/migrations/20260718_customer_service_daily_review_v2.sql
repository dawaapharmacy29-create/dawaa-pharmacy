begin;

create extension if not exists pgcrypto;

create table if not exists public.customer_service_daily_reviews (
  id uuid primary key default gen_random_uuid(),
  review_date date not null,
  branch text not null,
  owner_name text,
  total_count integer not null default 0,
  completed_count integer not null default 0,
  remaining_count integer not null default 0,
  no_answer_count integer not null default 0,
  scheduled_count integer not null default 0,
  needs_manager_count integer not null default 0,
  purchase_count integer not null default 0,
  purchase_amount numeric(14,2) not null default 0,
  completion_rate numeric(6,2) not null default 0,
  review_status text not null default 'reviewed',
  remaining_reason text,
  manager_notes text,
  reviewed_by_staff_id text,
  reviewed_by_name text,
  reviewed_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_service_daily_reviews_identity_uidx
  on public.customer_service_daily_reviews (review_date, branch);

create index if not exists customer_service_daily_reviews_date_idx
  on public.customer_service_daily_reviews (review_date desc, branch);

create or replace function public.touch_customer_service_daily_review()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_customer_service_daily_review
  on public.customer_service_daily_reviews;
create trigger trg_touch_customer_service_daily_review
before update on public.customer_service_daily_reviews
for each row execute function public.touch_customer_service_daily_review();

alter table public.customer_service_daily_reviews enable row level security;

drop policy if exists customer_service_daily_reviews_app_access
  on public.customer_service_daily_reviews;
create policy customer_service_daily_reviews_app_access
  on public.customer_service_daily_reviews
  for all to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update on public.customer_service_daily_reviews to anon, authenticated;

commit;

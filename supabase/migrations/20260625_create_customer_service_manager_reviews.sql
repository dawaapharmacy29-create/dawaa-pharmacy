-- Safe migration: customer_service_manager_reviews for manager/reviewer evaluations
-- insert/update only pattern; uses IF NOT EXISTS

create table if not exists public.customer_service_manager_reviews (
  id uuid primary key default gen_random_uuid(),
  source_review_id uuid null,
  linked_review_id uuid null,
  related_review_id uuid null,
  reviewed_staff_id uuid null,
  reviewed_staff_name text null,
  reviewer_id uuid null,
  reviewer_name text null,
  reviewer_role text null,
  manager_id uuid null,
  manager_name text null,
  score numeric not null default 100,
  review_score numeric null,
  notes text null,
  manager_notes text null,
  strengths text null,
  improvements text null,
  branch text null,
  role text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.customer_service_manager_reviews
  add column if not exists source_review_id uuid,
  add column if not exists linked_review_id uuid,
  add column if not exists related_review_id uuid,
  add column if not exists reviewed_staff_id uuid,
  add column if not exists reviewed_staff_name text,
  add column if not exists reviewer_id uuid,
  add column if not exists reviewer_name text,
  add column if not exists reviewer_role text,
  add column if not exists manager_id uuid,
  add column if not exists manager_name text,
  add column if not exists score numeric default 100,
  add column if not exists review_score numeric,
  add column if not exists notes text,
  add column if not exists manager_notes text,
  add column if not exists strengths text,
  add column if not exists improvements text,
  add column if not exists branch text,
  add column if not exists role text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

create index if not exists idx_csmr_source_review_id
  on public.customer_service_manager_reviews(source_review_id);

create index if not exists idx_csmr_reviewed_staff_id
  on public.customer_service_manager_reviews(reviewed_staff_id);

create index if not exists idx_csmr_reviewed_staff_name
  on public.customer_service_manager_reviews(reviewed_staff_name);

create index if not exists idx_csmr_created_at
  on public.customer_service_manager_reviews(created_at desc);

create index if not exists idx_csmr_branch
  on public.customer_service_manager_reviews(branch);

alter table public.customer_service_manager_reviews enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_service_manager_reviews'
      and policyname = 'customer_service_manager_reviews_select_all'
  ) then
    create policy customer_service_manager_reviews_select_all
    on public.customer_service_manager_reviews
    for select
    using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_service_manager_reviews'
      and policyname = 'customer_service_manager_reviews_insert_all'
  ) then
    create policy customer_service_manager_reviews_insert_all
    on public.customer_service_manager_reviews
    for insert
    with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'customer_service_manager_reviews'
      and policyname = 'customer_service_manager_reviews_update_all'
  ) then
    create policy customer_service_manager_reviews_update_all
    on public.customer_service_manager_reviews
    for update
    using (true)
    with check (true);
  end if;
end $$;


-- Dawaa Pharmacy 2027 - Conversation Reviews Manager Upgrade
-- شغّل هذا الملف مرة واحدة قبل تجربة تعديل تقييم المحادثات وتقييم المراجع.

alter table if exists public.conversation_sales_reviews
  add column if not exists manager_review_score numeric,
  add column if not exists manager_review_notes text,
  add column if not exists manager_reviewed_by text,
  add column if not exists manager_reviewed_at timestamptz,
  add column if not exists updated_at timestamptz;

create table if not exists public.customer_service_manager_reviews (
  id uuid primary key default gen_random_uuid(),
  source_review_id uuid,
  reviewer_id uuid,
  reviewer_name text,
  reviewer_role text,
  manager_id uuid,
  manager_name text,
  score numeric not null default 100,
  notes text,
  strengths text,
  improvements text,
  branch text,
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_service_manager_reviews_source
  on public.customer_service_manager_reviews(source_review_id);

create index if not exists idx_customer_service_manager_reviews_reviewer
  on public.customer_service_manager_reviews(reviewer_id);

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

-- تأكد أن جدول تقييمات المحادثات قابل للتحديث من التطبيق حسب صلاحياتك الحالية.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'conversation_sales_reviews'
      and policyname = 'conversation_sales_reviews_update_manager'
  ) then
    create policy conversation_sales_reviews_update_manager
    on public.conversation_sales_reviews
    for update
    using (true)
    with check (true);
  end if;
exception when undefined_table then
  raise notice 'conversation_sales_reviews table does not exist yet.';
end $$;

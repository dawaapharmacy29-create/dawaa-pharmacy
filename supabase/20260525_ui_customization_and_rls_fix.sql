-- Dawaa Pharmacy 2027
-- Safe upgrade for UI customization, offers/stories writes, and cleaning review fields.

create extension if not exists pgcrypto;

create table if not exists public.ui_layout_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id text,
  page_key text not null,
  layout_key text not null,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, page_key, layout_key)
);

alter table if exists public.branch_cleaning_tasks add column if not exists cleaner_name text;
alter table if exists public.branch_cleaning_tasks add column if not exists reviewer_staff_name text;
alter table if exists public.branch_cleaning_tasks add column if not exists reviewer_staff_id text;
alter table if exists public.branch_cleaning_tasks add column if not exists cleanliness_rating numeric;
alter table if exists public.branch_cleaning_tasks add column if not exists review_photo_url text;
alter table if exists public.branch_cleaning_tasks add column if not exists review_photo_path text;
alter table if exists public.branch_cleaning_tasks add column if not exists monthly_incentive_amount numeric default 500;
alter table if exists public.branch_cleaning_tasks add column if not exists updated_at timestamptz default now();
alter table if exists public.shift_exceptions add column if not exists updated_at timestamptz default now();

alter table if exists public.whatsapp_stories add column if not exists branch text;
alter table if exists public.whatsapp_stories add column if not exists uploaded_by_staff_id text;
alter table if exists public.whatsapp_stories add column if not exists uploaded_by_staff_name text;
alter table if exists public.whatsapp_stories add column if not exists image_path text;
alter table if exists public.whatsapp_stories add column if not exists updated_at timestamptz default now();

alter table if exists public.offers add column if not exists image_path text;
alter table if exists public.offers add column if not exists created_by_name text;
alter table if exists public.offers add column if not exists updated_at timestamptz default now();

do $$
declare
  t text;
begin
  foreach t in array array[
    'ui_layout_preferences',
    'offers',
    'offer_dispenses',
    'whatsapp_stories',
    'story_performance_reports',
    'story_sales',
    'branch_cleaning_tasks',
    'shift_exceptions'
  ]
  loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists "dawaa_read_%I" on public.%I', t, t);
      execute format('drop policy if exists "dawaa_write_%I" on public.%I', t, t);
      execute format('create policy "dawaa_read_%I" on public.%I for select to public using (true)', t, t);
      execute format('create policy "dawaa_write_%I" on public.%I for all to public using (true) with check (true)', t, t);
    end if;
  end loop;
end $$;

create index if not exists idx_ui_layout_preferences_page on public.ui_layout_preferences(page_key, layout_key);

do $$
begin
  if to_regclass('public.whatsapp_stories') is not null then
    create index if not exists idx_whatsapp_stories_branch_date on public.whatsapp_stories(branch, story_date);
  end if;
  if to_regclass('public.offers') is not null then
    create index if not exists idx_offers_branch_status on public.offers(branch, status);
  end if;
  if to_regclass('public.branch_cleaning_tasks') is not null then
    create index if not exists idx_branch_cleaning_tasks_branch_date on public.branch_cleaning_tasks(branch, task_date);
  end if;
end $$;

notify pgrst, 'reload schema';

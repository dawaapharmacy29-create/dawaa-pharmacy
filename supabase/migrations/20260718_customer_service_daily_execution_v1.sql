begin;

create extension if not exists pgcrypto;

alter table if exists public.daily_followups
  add column if not exists requested_by_staff_id text,
  add column if not exists assigned_to_staff_id text,
  add column if not exists handled_by_staff_id text,
  add column if not exists request_source text,
  add column if not exists first_attempt_at timestamptz,
  add column if not exists last_attempt_at timestamptz,
  add column if not exists attempt_count integer not null default 0;

create index if not exists daily_followups_requested_by_staff_idx
  on public.daily_followups (requested_by_staff_id, created_at desc);
create index if not exists daily_followups_next_followup_idx
  on public.daily_followups (next_followup_date, branch)
  where next_followup_date is not null;
create index if not exists daily_followups_customer_schedule_idx
  on public.daily_followups (branch, customer_code, followup_date desc);

create table if not exists public.customer_service_daily_queue_items (
  id uuid primary key default gen_random_uuid(),
  queue_date date not null,
  branch text not null,
  customer_key text not null,
  customer_id text,
  customer_code text,
  customer_name text not null,
  customer_phone text,
  source text not null,
  priority text not null default 'مهم',
  reason text,
  status text not null default 'not_started',
  linked_followup_id text references public.daily_followups(id) on delete set null,
  next_followup_date date,
  assigned_staff_id text,
  created_by text,
  created_by_name text,
  started_at timestamptz,
  completed_at timestamptz,
  last_action_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists customer_service_daily_queue_identity_uidx
  on public.customer_service_daily_queue_items (queue_date, branch, customer_key);
create index if not exists customer_service_daily_queue_status_idx
  on public.customer_service_daily_queue_items (queue_date, branch, status);
create index if not exists customer_service_daily_queue_next_idx
  on public.customer_service_daily_queue_items (next_followup_date, branch)
  where next_followup_date is not null;
create index if not exists customer_service_daily_queue_customer_history_idx
  on public.customer_service_daily_queue_items (branch, customer_key, queue_date desc);

create table if not exists public.customer_service_followup_events (
  id uuid primary key default gen_random_uuid(),
  followup_id text references public.daily_followups(id) on delete cascade,
  queue_item_id uuid references public.customer_service_daily_queue_items(id) on delete set null,
  event_type text not null,
  event_status text,
  actor_staff_id text,
  actor_name text,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists customer_service_followup_events_followup_idx
  on public.customer_service_followup_events (followup_id, created_at);
create index if not exists customer_service_followup_events_queue_idx
  on public.customer_service_followup_events (queue_item_id, created_at);

create or replace function public.touch_customer_service_daily_queue_item()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_customer_service_daily_queue_item
  on public.customer_service_daily_queue_items;
create trigger trg_touch_customer_service_daily_queue_item
before update on public.customer_service_daily_queue_items
for each row execute function public.touch_customer_service_daily_queue_item();

alter table public.customer_service_daily_queue_items enable row level security;
alter table public.customer_service_followup_events enable row level security;

drop policy if exists customer_service_daily_queue_app_access
  on public.customer_service_daily_queue_items;
create policy customer_service_daily_queue_app_access
  on public.customer_service_daily_queue_items
  for all to anon, authenticated
  using (true)
  with check (true);

drop policy if exists customer_service_followup_events_app_access
  on public.customer_service_followup_events;
create policy customer_service_followup_events_app_access
  on public.customer_service_followup_events
  for all to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.customer_service_daily_queue_items to anon, authenticated;
grant select, insert, update, delete on public.customer_service_followup_events to anon, authenticated;

commit;

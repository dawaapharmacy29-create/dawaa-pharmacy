begin;

create extension if not exists pgcrypto;

create table if not exists public.customer_service_manager_cases (
  id uuid primary key default gen_random_uuid(),
  followup_id text references public.daily_followups(id) on delete set null,
  queue_item_id uuid references public.customer_service_daily_queue_items(id) on delete set null,
  branch text not null,
  customer_id text,
  customer_code text,
  customer_name text not null default 'عميل غير مسجل',
  customer_phone text,
  case_type text not null default 'manager_intervention',
  complaint_category text,
  severity text not null default 'medium',
  status text not null default 'open',
  escalation_reason text not null,
  customer_impact text,
  requested_action text,
  manager_decision text,
  resolution_notes text,
  root_cause text,
  compensation_type text,
  compensation_amount numeric(14,2) not null default 0,
  customer_satisfaction_after text,
  escalated_by_staff_id text,
  escalated_by_name text,
  accepted_by_staff_id text,
  accepted_by_name text,
  accepted_at timestamptz,
  due_at timestamptz,
  resolved_by_staff_id text,
  resolved_by_name text,
  resolved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_service_manager_cases_status_chk check (status in ('open','accepted','returned','in_progress','resolved','closed')),
  constraint customer_service_manager_cases_severity_chk check (severity in ('low','medium','high','critical'))
);

create unique index if not exists customer_service_manager_cases_open_followup_uidx
on public.customer_service_manager_cases (followup_id)
where followup_id is not null and status in ('open','accepted','in_progress','returned');

create index if not exists customer_service_manager_cases_branch_status_idx
on public.customer_service_manager_cases (branch, status, created_at desc);

create index if not exists customer_service_manager_cases_due_idx
on public.customer_service_manager_cases (due_at)
where status not in ('resolved','closed');

create or replace function public.touch_customer_service_manager_case()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_customer_service_manager_case on public.customer_service_manager_cases;
create trigger trg_touch_customer_service_manager_case
before update on public.customer_service_manager_cases
for each row execute function public.touch_customer_service_manager_case();

alter table public.customer_service_manager_cases enable row level security;

drop policy if exists customer_service_manager_cases_app_access on public.customer_service_manager_cases;
create policy customer_service_manager_cases_app_access
on public.customer_service_manager_cases
for all to anon, authenticated
using (true) with check (true);

grant select, insert, update on public.customer_service_manager_cases to anon, authenticated;

commit;

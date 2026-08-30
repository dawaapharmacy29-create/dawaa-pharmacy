-- Cleaning Governance V3: durable daily historical snapshots.
-- Historical reports must never be reinterpreted by future checklist configuration changes.

create table if not exists public.cleaning_daily_governance_snapshots (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  branch text not null,
  snapshot_date date not null,
  month_cycle text not null,
  governance_version integer not null default 3,
  required_items integer not null default 0,
  submitted_items integer not null default 0,
  reviewed_items integer not null default 0,
  approved_items integer not null default 0,
  rejected_items integer not null default 0,
  pending_items integer not null default 0,
  max_stars integer not null default 0,
  rating_ready boolean not null default false,
  timing_attention_items integer not null default 0,
  on_time_items integer not null default 0,
  checklist_snapshot jsonb not null default '[]'::jsonb,
  finalized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(staff_id,snapshot_date)
);

create index if not exists cleaning_governance_snapshots_cycle_staff_idx
  on public.cleaning_daily_governance_snapshots(month_cycle,staff_id,snapshot_date);
create index if not exists cleaning_governance_snapshots_branch_cycle_idx
  on public.cleaning_daily_governance_snapshots(branch,month_cycle,snapshot_date);

alter table public.cleaning_daily_governance_snapshots enable row level security;
revoke all privileges on table public.cleaning_daily_governance_snapshots from anon,authenticated;

alter table public.cleaning_daily_ratings
  add column if not exists governance_snapshot_id uuid references public.cleaning_daily_governance_snapshots(id) on delete restrict,
  add column if not exists governance_version integer,
  add column if not exists required_items_snapshot integer,
  add column if not exists submitted_items_snapshot integer,
  add column if not exists reviewed_items_snapshot integer,
  add column if not exists approved_items_snapshot integer,
  add column if not exists rejected_items_snapshot integer,
  add column if not exists pending_items_snapshot integer,
  add column if not exists max_stars_snapshot integer;

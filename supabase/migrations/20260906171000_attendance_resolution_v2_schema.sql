-- Canonical Attendance Resolution V2 schema.
-- Raw biometric rows remain immutable evidence; financial consumers use approved daily snapshots only.

alter table public.attendance_daily_summary
  add column if not exists resolution_origin text,
  add column if not exists review_required boolean not null default true,
  add column if not exists resolved_at timestamptz,
  add column if not exists time_off_request_id uuid,
  add column if not exists policy_version text,
  add column if not exists sync_complete_through timestamptz;

create index if not exists idx_attendance_daily_summary_review_queue
  on public.attendance_daily_summary(status, attendance_date desc, branch)
  where status = 'pending_review';

create table if not exists public.attendance_resolution_audit (
  id uuid primary key default gen_random_uuid(),
  resolution_id uuid not null references public.attendance_daily_summary(id) on delete restrict,
  staff_id uuid not null,
  attendance_date date not null,
  action text not null,
  actor_id text,
  actor_name text,
  actor_role text,
  note text,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_resolution_audit_staff_date
  on public.attendance_resolution_audit(staff_id, attendance_date desc, created_at desc);

create table if not exists public.attendance_impact_ledger (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  staff_id uuid not null,
  attendance_date date not null,
  event_type text not null,
  source_resolution_id uuid not null references public.attendance_daily_summary(id) on delete restrict,
  source_time_off_request_id uuid,
  policy_version text,
  points_impact numeric not null default 0,
  incentive_impact numeric not null default 0,
  payroll_units_impact numeric not null default 0,
  monetary_impact numeric not null default 0,
  impact_status text not null default 'classified',
  evidence_snapshot jsonb not null default '{}'::jsonb,
  reversal_of uuid references public.attendance_impact_ledger(id) on delete restrict,
  created_at timestamptz not null default now(),
  created_by text
);

create index if not exists idx_attendance_impact_ledger_staff_date
  on public.attendance_impact_ledger(staff_id, attendance_date desc, created_at desc);
create index if not exists idx_attendance_impact_ledger_resolution
  on public.attendance_impact_ledger(source_resolution_id);

revoke all on table public.attendance_resolution_audit from anon, authenticated;
revoke all on table public.attendance_impact_ledger from anon, authenticated;
grant all on table public.attendance_resolution_audit to service_role;
grant all on table public.attendance_impact_ledger to service_role;

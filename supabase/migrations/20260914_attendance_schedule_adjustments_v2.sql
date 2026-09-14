-- DEVELOPMENT BRANCH ONLY. Do not apply to production before attendance-intelligence-v2 review.

create table if not exists public.attendance_schedule_adjustments (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null,
  staff_name_snapshot text,
  branch_snapshot text,
  work_date date not null,
  adjustment_kind text not null check (adjustment_kind in (
    'shift_change', 'shift_swap', 'late_start_permission', 'early_leave_permission',
    'partial_permission', 'mission', 'training', 'manual_correction'
  )),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  original_start time,
  original_end time,
  effective_start time,
  effective_end time,
  protected_start time,
  protected_end time,
  swap_with_staff_id uuid,
  swap_with_staff_name_snapshot text,
  reason text,
  requested_by text,
  requested_by_name text,
  requested_at timestamptz not null default now(),
  decided_by text,
  decided_by_name text,
  decided_at timestamptz,
  decision_note text,
  cancelled_by text,
  cancelled_at timestamptz,
  cancellation_reason text,
  source text not null default 'attendance_center',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_attendance_schedule_adjustments_staff_date
  on public.attendance_schedule_adjustments (staff_id, work_date, status);
create index if not exists idx_attendance_schedule_adjustments_branch_date
  on public.attendance_schedule_adjustments (branch_snapshot, work_date, status);
create index if not exists idx_attendance_schedule_adjustments_swap
  on public.attendance_schedule_adjustments (swap_with_staff_id, work_date)
  where swap_with_staff_id is not null;

create table if not exists public.attendance_schedule_adjustment_audit (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null references public.attendance_schedule_adjustments(id) on delete cascade,
  staff_id uuid not null,
  work_date date not null,
  action text not null,
  actor_id text,
  actor_name text,
  actor_role text,
  before_state jsonb,
  after_state jsonb,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_attendance_schedule_adjustment_audit_adjustment
  on public.attendance_schedule_adjustment_audit (adjustment_id, created_at desc);

comment on table public.attendance_schedule_adjustments is
  'Governed attendance schedule changes. Raw schedule is never overwritten; approved adjustments define effective expectations.';
comment on table public.attendance_schedule_adjustment_audit is
  'Immutable audit trail for schedule adjustment lifecycle and approvals.';

alter table public.attendance_schedule_adjustments enable row level security;
alter table public.attendance_schedule_adjustment_audit enable row level security;

-- Policies intentionally omitted from this development migration until the existing role/RLS model is reviewed.
-- Production rollout must add explicit scoped read/write policies before applying.

create or replace function public.attendance_schedule_adjustments_for_day_v1(
  p_date date,
  p_branch text default null
)
returns table (
  id uuid,
  staff_id uuid,
  staff_name_snapshot text,
  branch_snapshot text,
  work_date date,
  adjustment_kind text,
  status text,
  original_start time,
  original_end time,
  effective_start time,
  effective_end time,
  protected_start time,
  protected_end time,
  swap_with_staff_id uuid,
  swap_with_staff_name_snapshot text,
  reason text,
  decided_by_name text,
  decided_at timestamptz,
  metadata jsonb
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    a.id,
    a.staff_id,
    a.staff_name_snapshot,
    a.branch_snapshot,
    a.work_date,
    a.adjustment_kind,
    a.status,
    a.original_start,
    a.original_end,
    a.effective_start,
    a.effective_end,
    a.protected_start,
    a.protected_end,
    a.swap_with_staff_id,
    a.swap_with_staff_name_snapshot,
    a.reason,
    a.decided_by_name,
    a.decided_at,
    a.metadata
  from public.attendance_schedule_adjustments a
  where a.work_date = p_date
    and (p_branch is null or a.branch_snapshot = p_branch)
  order by
    case a.status when 'pending' then 0 when 'approved' then 1 else 2 end,
    a.staff_name_snapshot nulls last;
$$;

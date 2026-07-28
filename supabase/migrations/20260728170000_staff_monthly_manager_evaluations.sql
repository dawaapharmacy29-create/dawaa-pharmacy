create table if not exists public.staff_monthly_manager_evaluations (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null,
  staff_name text not null,
  staff_role text,
  branch text not null,
  evaluation_month date not null,
  evaluator_id uuid,
  evaluator_name text not null,
  evaluator_role text,
  sections jsonb not null default '[]'::jsonb,
  metrics_snapshot jsonb not null default '{}'::jsonb,
  strengths text[] not null default '{}',
  development_points text[] not null default '{}',
  manager_notes text,
  employee_comment text,
  overall_score numeric(6,2) not null default 0,
  grade text not null default 'يحتاج تقييم',
  suggested_incentive numeric(12,2) not null default 0,
  approved_incentive numeric(12,2) not null default 0,
  points_delta numeric(12,2) not null default 0,
  status text not null default 'draft' check (status in ('draft','approved','sent','acknowledged')),
  sent_at timestamptz,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, evaluation_month)
);

create index if not exists staff_monthly_manager_evaluations_branch_month_idx
  on public.staff_monthly_manager_evaluations(branch, evaluation_month desc);
create index if not exists staff_monthly_manager_evaluations_staff_month_idx
  on public.staff_monthly_manager_evaluations(staff_id, evaluation_month desc);

alter table public.staff_monthly_manager_evaluations enable row level security;

drop policy if exists "staff evaluations authenticated read" on public.staff_monthly_manager_evaluations;
create policy "staff evaluations authenticated read"
  on public.staff_monthly_manager_evaluations for select
  to authenticated using (true);

drop policy if exists "staff evaluations authenticated write" on public.staff_monthly_manager_evaluations;
create policy "staff evaluations authenticated write"
  on public.staff_monthly_manager_evaluations for all
  to authenticated using (true) with check (true);

create or replace function public.touch_staff_monthly_manager_evaluations()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists staff_monthly_manager_evaluations_touch on public.staff_monthly_manager_evaluations;
create trigger staff_monthly_manager_evaluations_touch
before update on public.staff_monthly_manager_evaluations
for each row execute function public.touch_staff_monthly_manager_evaluations();

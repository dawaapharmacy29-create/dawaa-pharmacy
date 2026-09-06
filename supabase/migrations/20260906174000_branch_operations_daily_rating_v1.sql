-- Branch operations daily rating storage v1.
-- Runtime governance and points projection live in the following convergence migration.

begin;

create table if not exists public.branch_operations_daily_ratings(
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete restrict,
  branch text not null,
  rating_date date not null,
  month_cycle text not null,
  stars integer not null check(stars between 1 and 5),
  score_pct numeric not null check(score_pct between 0 and 100),
  points_delta numeric not null default 0,
  required_items integer not null default 0,
  submitted_items integer not null default 0,
  reviewed_items integer not null default 0,
  approved_items integer not null default 0,
  rejected_items integer not null default 0,
  pending_items integer not null default 0,
  max_stars integer not null default 0,
  manager_note text null,
  rated_by text null,
  rated_by_name text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(staff_id,rating_date)
);

alter table public.branch_operations_daily_ratings enable row level security;

create index if not exists idx_branch_operations_daily_ratings_staff_cycle
  on public.branch_operations_daily_ratings(staff_id,month_cycle,rating_date desc);
create index if not exists idx_branch_operations_daily_ratings_branch_date
  on public.branch_operations_daily_ratings(branch,rating_date desc);

-- Read path only. Writes remain RPC-only because no insert/update/delete grants are exposed.
drop policy if exists branch_operations_daily_ratings_scoped_select_v1 on public.branch_operations_daily_ratings;
create policy branch_operations_daily_ratings_scoped_select_v1
on public.branch_operations_daily_ratings
for select to anon,authenticated
using(
  public.dawaa_current_staff_account_id_strict() is not null
  and(
    staff_id=public.dawaa_current_staff_subject_uuid_v1()
    or(
      public.user_has_permission(public.dawaa_current_staff_account_id_strict(),'view_team')
      and(
        lower(trim(coalesce(public.employee_operating_actor_role(),''))) in('general_manager','executive_manager','branches_manager','admin')
        or public.dawaa_review_coverage_branch_key_v1(branch)=public.dawaa_review_coverage_branch_key_v1(public.employee_operating_actor_branch())
      )
    )
  )
);

grant select on public.branch_operations_daily_ratings to anon,authenticated;

commit;

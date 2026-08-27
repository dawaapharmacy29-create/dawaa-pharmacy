-- Architecture Hardening V5
-- Remove overlapping permissive ALL+SELECT policies from core employee finance/evaluation tables.
-- Existing access semantics are preserved: self/manager read; GM/executive write for finance;
-- manager roles write weekly evaluations.

-- ---------------------------------------------------------------------------
-- employee_compensation_profiles
-- ---------------------------------------------------------------------------
drop policy if exists employee_compensation_admin_write_v1 on public.employee_compensation_profiles;
drop policy if exists employee_compensation_self_read_v1 on public.employee_compensation_profiles;

create policy employee_compensation_read_v2
on public.employee_compensation_profiles
for select
to anon, authenticated
using (
  staff_id = dawaa_current_staff_id_v1()
  or exists (
    select 1 from public.staff_accounts sa
    where sa.id::text = coalesce(
      ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
      ((select auth.uid()))::text
    )
    and sa.role = any (array['general_manager','executive_manager','branches_manager']::text[])
  )
);

create policy employee_compensation_admin_insert_v2
on public.employee_compensation_profiles
for insert
to anon, authenticated
with check (
  exists (
    select 1 from public.staff_accounts sa
    where sa.id::text = coalesce(
      ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
      ((select auth.uid()))::text
    )
    and sa.role = any (array['general_manager','executive_manager']::text[])
  )
);

create policy employee_compensation_admin_update_v2
on public.employee_compensation_profiles
for update
to anon, authenticated
using (
  exists (
    select 1 from public.staff_accounts sa
    where sa.id::text = coalesce(
      ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
      ((select auth.uid()))::text
    )
    and sa.role = any (array['general_manager','executive_manager']::text[])
  )
)
with check (
  exists (
    select 1 from public.staff_accounts sa
    where sa.id::text = coalesce(
      ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
      ((select auth.uid()))::text
    )
    and sa.role = any (array['general_manager','executive_manager']::text[])
  )
);

create policy employee_compensation_admin_delete_v2
on public.employee_compensation_profiles
for delete
to anon, authenticated
using (
  exists (
    select 1 from public.staff_accounts sa
    where sa.id::text = coalesce(
      ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
      ((select auth.uid()))::text
    )
    and sa.role = any (array['general_manager','executive_manager']::text[])
  )
);

-- ---------------------------------------------------------------------------
-- employee_monthly_statements
-- ---------------------------------------------------------------------------
drop policy if exists employee_statements_admin_write_v1 on public.employee_monthly_statements;
drop policy if exists employee_statements_self_read_v1 on public.employee_monthly_statements;

create policy employee_statements_read_v2
on public.employee_monthly_statements
for select
to anon, authenticated
using (
  staff_id = dawaa_current_staff_id_v1()
  or exists (
    select 1 from public.staff_accounts sa
    where sa.id::text = coalesce(
      ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
      ((select auth.uid()))::text
    )
    and sa.role = any (array['general_manager','executive_manager','branches_manager']::text[])
  )
);

create policy employee_statements_admin_insert_v2
on public.employee_monthly_statements
for insert
to anon, authenticated
with check (
  exists (
    select 1 from public.staff_accounts sa
    where sa.id::text = coalesce(
      ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
      ((select auth.uid()))::text
    )
    and sa.role = any (array['general_manager','executive_manager']::text[])
  )
);

create policy employee_statements_admin_update_v2
on public.employee_monthly_statements
for update
to anon, authenticated
using (
  exists (
    select 1 from public.staff_accounts sa
    where sa.id::text = coalesce(
      ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
      ((select auth.uid()))::text
    )
    and sa.role = any (array['general_manager','executive_manager']::text[])
  )
)
with check (
  exists (
    select 1 from public.staff_accounts sa
    where sa.id::text = coalesce(
      ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
      ((select auth.uid()))::text
    )
    and sa.role = any (array['general_manager','executive_manager']::text[])
  )
);

create policy employee_statements_admin_delete_v2
on public.employee_monthly_statements
for delete
to anon, authenticated
using (
  exists (
    select 1 from public.staff_accounts sa
    where sa.id::text = coalesce(
      ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
      ((select auth.uid()))::text
    )
    and sa.role = any (array['general_manager','executive_manager']::text[])
  )
);

-- ---------------------------------------------------------------------------
-- manager_weekly_evaluations
-- ---------------------------------------------------------------------------
drop policy if exists manager_weekly_evaluations_read_v1 on public.manager_weekly_evaluations;
drop policy if exists manager_weekly_evaluations_write_v1 on public.manager_weekly_evaluations;

create policy manager_weekly_evaluations_read_v2
on public.manager_weekly_evaluations
for select
to anon, authenticated
using (
  subject_staff_id::text = dawaa_current_staff_id_v1()
  or evaluator_staff_id::text = dawaa_current_staff_id_v1()
  or exists (
    select 1 from public.staff_accounts sa
    where sa.id::text = coalesce(
      ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
      ((select auth.uid()))::text
    )
    and sa.role = any (array['general_manager','executive_manager','branches_manager']::text[])
  )
);

create policy manager_weekly_evaluations_admin_insert_v2
on public.manager_weekly_evaluations
for insert
to anon, authenticated
with check (
  exists (
    select 1 from public.staff_accounts sa
    where sa.id::text = coalesce(
      ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
      ((select auth.uid()))::text
    )
    and sa.role = any (array['general_manager','executive_manager','branches_manager']::text[])
  )
);

create policy manager_weekly_evaluations_admin_update_v2
on public.manager_weekly_evaluations
for update
to anon, authenticated
using (
  exists (
    select 1 from public.staff_accounts sa
    where sa.id::text = coalesce(
      ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
      ((select auth.uid()))::text
    )
    and sa.role = any (array['general_manager','executive_manager','branches_manager']::text[])
  )
)
with check (
  exists (
    select 1 from public.staff_accounts sa
    where sa.id::text = coalesce(
      ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
      ((select auth.uid()))::text
    )
    and sa.role = any (array['general_manager','executive_manager','branches_manager']::text[])
  )
);

create policy manager_weekly_evaluations_admin_delete_v2
on public.manager_weekly_evaluations
for delete
to anon, authenticated
using (
  exists (
    select 1 from public.staff_accounts sa
    where sa.id::text = coalesce(
      ((select current_setting('request.headers', true))::jsonb ->> 'x-dawaa-user-id'),
      ((select auth.uid()))::text
    )
    and sa.role = any (array['general_manager','executive_manager','branches_manager']::text[])
  )
);

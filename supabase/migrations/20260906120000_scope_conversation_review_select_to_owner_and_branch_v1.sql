-- Fix: conversation_sales_reviews_select_canonical currently gates SELECT purely on
-- the permission name 'view_reviews'. Every role that can use the Reviews/Doctor
-- pages holds that permission (general_manager, executive_manager, branches_manager,
-- branch_manager, customer_service_manager, customer_service, shift_supervisor_*,
-- and pharmacist/doctor). Because there was no row-level condition, ANY authenticated
-- account with that permission -- including a doctor -- could read every review row for
-- every doctor across both branches directly from the database (e.g. via a raw
-- PostgREST call), even though the app UI only ever shows a doctor their own reviews.
--
-- This migration adds row-level scoping, mirroring the pattern already used for
-- employee_compensation_profiles and customer_cashback (self/manager/branch), without
-- changing any permission names or the app-level UI:
--   - top management (general_manager/executive_manager/branches_manager): all rows
--   - the reviewer who authored the review: their own authored rows
--   - branch-level managers/supervisors (branch_manager, customer_service_manager,
--     customer_service, shift_supervisor_morning/evening): rows for their own branch
--   - a doctor/pharmacist: only rows where they are the reviewed staff member
--     (matches the app's own stated behavior: "كل تقييم مرتبط بحسابك فقط")
--
-- APPLIED DIRECTLY TO PRODUCTION on 2026-09-06 via Supabase MCP. This file mirrors
-- that change into version control -- it does not need to be re-applied.

create or replace function public.dawaa_can_read_conversation_review_row_v1(
  p_staff_id uuid,
  p_doctor_id uuid,
  p_branch text,
  p_reviewer_id uuid
)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $$
  with me as (
    select sa.*
    from public.staff_accounts sa
    where sa.id = public.dawaa_current_staff_account_id_strict()
      and coalesce(sa.active, false)
      and coalesce(sa.can_login, false)
    limit 1
  )
  select exists (
    select 1
    from me
    where
      lower(trim(coalesce(me.role, ''))) in ('general_manager', 'executive_manager', 'branches_manager', 'admin')
      or me.id = p_reviewer_id
      or me.staff_id = p_staff_id::text
      or me.staff_id = p_doctor_id::text
      or (
        lower(trim(coalesce(me.role, ''))) in (
          'branch_manager', 'customer_service_manager', 'customer_service',
          'shift_supervisor_morning', 'shift_supervisor_evening'
        )
        and public.dawaa_customer_request_branch_key(me.branch) is not null
        and public.dawaa_customer_request_branch_key(me.branch) = public.dawaa_customer_request_branch_key(p_branch)
      )
  )
$$;

revoke all on function public.dawaa_can_read_conversation_review_row_v1(uuid, uuid, text, uuid) from public;

drop policy if exists conversation_sales_reviews_select_canonical on public.conversation_sales_reviews;
create policy conversation_sales_reviews_select_canonical
on public.conversation_sales_reviews
for select
to anon, authenticated
using (
  public.dawaa_current_actor_can(array['view_reviews'])
  and public.dawaa_can_read_conversation_review_row_v1(staff_id, doctor_id, branch, reviewer_id)
);

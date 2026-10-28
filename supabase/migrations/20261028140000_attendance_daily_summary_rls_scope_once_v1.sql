-- attendance_daily_summary: evaluate the read-scope functions once per statement.
--
-- The SELECT policy called three SECURITY DEFINER functions as plain expressions, so PostgreSQL
-- evaluated them for every row (≈6 s for one 26→25 cycle, ~1,100 rows, from the browser). Wrapping
-- each call in a scalar sub-select turns it into an InitPlan evaluated once per statement.
-- The predicate, roles and visible rows are unchanged (proven by
-- scripts/verification/test-attendance-summary-rls-scope-native.mjs).
--
-- Rollback: recreate the policy with the previous expression:
--   (dawaa_actor_is_top_management_v1() OR dawaa_current_actor_can(ARRAY['manage_attendance','manage_payroll'])
--    OR (staff_id = dawaa_current_staff_subject_uuid_v1()))

begin;

drop policy if exists attendance_daily_summary_select on public.attendance_daily_summary;
create policy attendance_daily_summary_select on public.attendance_daily_summary
  for select to public
  using (
    (select public.dawaa_actor_is_top_management_v1())
    or (select public.dawaa_current_actor_can(array['manage_attendance'::text, 'manage_payroll'::text]))
    or staff_id = (select public.dawaa_current_staff_subject_uuid_v1())
  );

commit;

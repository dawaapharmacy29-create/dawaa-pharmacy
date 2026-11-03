-- The app calls the database as anon with the staff session (dawaa_current_staff_account_id_strict), like
-- get_gm_daily_review_v1. The shift handover and «التقارير المجمعة» reads were granted to authenticated
-- only, so the pages failed with «permission denied». Grant anon the same reads; the checks inside
-- (RLS on shift_handovers, gm_daily_review_actor_v1 in the functions) still decide who sees what.
-- Writes stay closed: corrections go through correct_shift_handover_v1 only.

grant select on public.shift_handovers to anon;

grant select on public.shift_handover_corrections_v1 to anon;
drop policy if exists shift_handover_corrections_select on public.shift_handover_corrections_v1;
create policy shift_handover_corrections_select on public.shift_handover_corrections_v1 for select to anon, authenticated
  using (exists (select 1 from public.shift_handovers h where h.id = handover_id));

grant execute on function public.shift_handover_on_duty_v1(date, date) to anon;
grant execute on function public.correct_shift_handover_v1(uuid, jsonb, text) to anon;
grant execute on function public.get_accountant_report_v1(text) to anon;

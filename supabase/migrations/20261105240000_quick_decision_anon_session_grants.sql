-- The app calls RPCs as the anon role with its own staff session token (see
-- 20261101170000_base44_reports_anon_session_grants_v1). Both functions check the session and the
-- actor's rights inside, like the routines they wrap.
--   * dr_wael_quick_day_decision_v1 was granted to authenticated only, so every quick decision failed;
--   * 20261105220000 re-revoked shift_handover_on_duty_v1 from anon by mistake.
grant execute on function public.dr_wael_quick_day_decision_v1(uuid, date, text) to anon;
grant execute on function public.shift_handover_on_duty_v1(date, date) to anon;

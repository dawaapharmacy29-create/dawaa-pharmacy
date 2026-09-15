begin;

-- `calculate_staff_incentive_egp` and `get_doctor_pillar_breakdown` use this
-- helper in default arguments. PostgreSQL evaluates those defaults under the
-- caller role before entering the SECURITY DEFINER function body, so the app
-- transport roles must be allowed to execute this non-sensitive cycle-label
-- helper.
revoke all on function public.dawaa_current_points_cycle_label_v1() from public;
grant execute on function public.dawaa_current_points_cycle_label_v1()
  to anon, authenticated, service_role;

comment on function public.dawaa_current_points_cycle_label_v1() is
  'Returns the current Dawaa points cycle label (26→25, Africa/Cairo). Safe helper for RPC default parameters; executable by app transport roles.';

commit;

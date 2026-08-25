-- Explicitly remove inherited anonymous EXECUTE grants from points truth RPCs.
revoke execute on function public.dawaa_staff_points_truth_v2(uuid, text) from anon;
revoke execute on function public.calculate_staff_incentive_egp(uuid, text) from anon;
revoke execute on function public.get_doctor_live_incentive_total(uuid) from anon;
revoke execute on function public.get_doctor_pillar_breakdown(uuid, text) from anon;
revoke execute on function public.dawaa_points_integrity_check_v2() from anon;

grant execute on function public.dawaa_staff_points_truth_v2(uuid, text) to authenticated;
grant execute on function public.calculate_staff_incentive_egp(uuid, text) to authenticated;
grant execute on function public.get_doctor_live_incentive_total(uuid) to authenticated;
grant execute on function public.get_doctor_pillar_breakdown(uuid, text) to authenticated;
grant execute on function public.dawaa_points_integrity_check_v2() to authenticated;

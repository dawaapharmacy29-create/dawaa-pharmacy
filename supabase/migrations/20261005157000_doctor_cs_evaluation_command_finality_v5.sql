-- Guard the canonical command before UPSERT so final decisions fail deterministically.
create or replace function public.dawaa_assert_doctor_cs_evaluation_mutable_v5(
  p_doctor_id uuid,
  p_evaluation_month date
)
returns void
language plpgsql stable security definer
set search_path='public','pg_catalog'
as $function$
begin
  if exists(
    select 1 from public.doctor_customer_service_evaluations e
    where e.doctor_id=p_doctor_id
      and e.evaluation_month=p_evaluation_month
      and e.status in ('sent','approved')
  ) then
    raise exception 'doctor_cs_evaluation_final_decision_immutable'
      using errcode='55000';
  end if;
end;
$function$;

revoke all on function public.dawaa_assert_doctor_cs_evaluation_mutable_v5(uuid,date) from public,anon,authenticated;
grant execute on function public.dawaa_assert_doctor_cs_evaluation_mutable_v5(uuid,date) to service_role;

notify pgrst,'reload schema';

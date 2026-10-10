-- Final doctor/customer-service evaluations are immutable financial decisions.
create or replace function public.trg_doctor_cs_evaluation_final_immutable_v5()
returns trigger language plpgsql security definer
set search_path='public','pg_catalog'
as $function$
begin
  if tg_op='DELETE' and old.status in ('sent','approved') then
    raise exception 'doctor_cs_evaluation_final_decision_immutable' using errcode='55000';
  end if;
  if tg_op='UPDATE' and old.status in ('sent','approved') and new is distinct from old then
    raise exception 'doctor_cs_evaluation_final_decision_immutable'
      using errcode='55000',
            detail='Final doctor customer-service evaluations cannot be silently rewritten.';
  end if;
  return coalesce(new,old);
end;
$function$;

drop trigger if exists doctor_cs_evaluation_final_immutable_v5 on public.doctor_customer_service_evaluations;
create trigger doctor_cs_evaluation_final_immutable_v5
before update or delete on public.doctor_customer_service_evaluations
for each row execute function public.trg_doctor_cs_evaluation_final_immutable_v5();

comment on function public.trg_doctor_cs_evaluation_final_immutable_v5()
is 'Protects final CS-doctor evaluation score, evidence and points provenance from silent mutation.';

notify pgrst,'reload schema';

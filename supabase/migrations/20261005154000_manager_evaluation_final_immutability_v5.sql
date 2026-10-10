-- Final manager evaluations are immutable decisions.
-- Corrections must be explicit audited adjustments, never silent rewrites.
create or replace function public.trg_manager_evaluation_final_immutable_v5()
returns trigger
language plpgsql
security definer
set search_path='public','pg_catalog'
as $function$
begin
  if tg_op='DELETE' and old.status='submitted' then
    raise exception 'manager_evaluation_final_decision_immutable' using errcode='55000';
  end if;

  if tg_op='UPDATE' and old.status='submitted' then
    if new is distinct from old then
      raise exception 'manager_evaluation_final_decision_immutable'
        using errcode='55000',
              detail='Submitted manager evaluations are immutable. Use an explicit correction/adjustment workflow.';
    end if;
  end if;
  return coalesce(new,old);
end;
$function$;

drop trigger if exists manager_evaluation_final_immutable_v5 on public.manager_weekly_evaluations;
create trigger manager_evaluation_final_immutable_v5
before update or delete on public.manager_weekly_evaluations
for each row execute function public.trg_manager_evaluation_final_immutable_v5();

comment on function public.trg_manager_evaluation_final_immutable_v5()
is 'Prevents silent mutation/deletion of a submitted manager evaluation decision.';

notify pgrst,'reload schema';

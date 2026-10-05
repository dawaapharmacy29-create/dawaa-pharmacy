-- A published monthly evaluation is a final decision, not a mutable working row.
-- Payroll finalization remains an additional financial freeze; this guard starts at publication.
create or replace function public.trg_monthly_evaluation_final_decision_immutable_v5()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if tg_op='DELETE' and old.status in ('sent','approved') then
    raise exception 'monthly_evaluation_final_decision_immutable'
      using errcode='55000',
            detail='Published monthly evaluations are immutable. Use an explicit correction/reopen workflow.';
  end if;

  if tg_op='UPDATE'
     and old.status in ('sent','approved')
     and new is distinct from old then
    -- The canonical V5 command performs one internal post-insert timestamp touch
    -- only when finalizing the same decision. It must not alter decision content.
    if new.status=old.status
       and new.staff_id is not distinct from old.staff_id
       and new.evaluation_month is not distinct from old.evaluation_month
       and new.sections is not distinct from old.sections
       and new.overall_score is not distinct from old.overall_score
       and new.grade is not distinct from old.grade
       and new.manager_notes is not distinct from old.manager_notes
       and new.strengths is not distinct from old.strengths
       and new.development_points is not distinct from old.development_points
       and new.metrics_snapshot is not distinct from old.metrics_snapshot
       and new.sent_at is not distinct from old.sent_at
    then
      return new;
    end if;
    raise exception 'monthly_evaluation_final_decision_immutable'
      using errcode='55000',
            detail='Published monthly evaluations cannot be silently rewritten.';
  end if;

  return coalesce(new,old);
end;
$function$;

drop trigger if exists monthly_evaluation_final_decision_immutable_v5
  on public.staff_monthly_manager_evaluations;
create trigger monthly_evaluation_final_decision_immutable_v5
before update or delete on public.staff_monthly_manager_evaluations
for each row execute function public.trg_monthly_evaluation_final_decision_immutable_v5();

revoke all on function public.trg_monthly_evaluation_final_decision_immutable_v5()
  from public,anon,authenticated;
grant execute on function public.trg_monthly_evaluation_final_decision_immutable_v5()
  to service_role;

comment on function public.trg_monthly_evaluation_final_decision_immutable_v5()
is 'Freezes the exact published monthly evaluation decision before payroll; later corrections require an explicit audited workflow.';

notify pgrst,'reload schema';

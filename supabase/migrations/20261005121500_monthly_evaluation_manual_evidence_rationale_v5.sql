-- Enforce documented rationale for every manually-evidenced monthly evaluation axis.
-- Client validation is UX only; final approval must remain defensible at the database boundary.

create or replace function public.trg_monthly_evaluation_manual_evidence_rationale_v5()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
begin
  if new.status not in ('sent','approved') then
    return new;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(new.sections,'[]'::jsonb)) section
    join jsonb_array_elements(coalesce(new.metrics_snapshot->'axis_evidence_snapshot','[]'::jsonb)) evidence
      on evidence->>'key' = section->>'key'
    where lower(coalesce(evidence->>'status','')) = 'manual'
      and coalesce((section->>'score')::numeric,0) > 0
      and char_length(btrim(coalesce(section->>'notes',''))) < 12
  ) then
    raise exception 'monthly_evaluation_manual_evidence_rationale_required'
      using errcode='23514',
            detail='Every scored manual-evidence axis requires a documented fact/result of at least 12 characters before final approval.';
  end if;

  return new;
end;
$function$;

drop trigger if exists zy_monthly_evaluation_manual_evidence_rationale_v5
  on public.staff_monthly_manager_evaluations;

create trigger zy_monthly_evaluation_manual_evidence_rationale_v5
before insert or update of sections,metrics_snapshot,status
on public.staff_monthly_manager_evaluations
for each row
execute function public.trg_monthly_evaluation_manual_evidence_rationale_v5();

revoke all on function public.trg_monthly_evaluation_manual_evidence_rationale_v5() from public;
revoke all on function public.trg_monthly_evaluation_manual_evidence_rationale_v5() from anon;
revoke all on function public.trg_monthly_evaluation_manual_evidence_rationale_v5() from authenticated;

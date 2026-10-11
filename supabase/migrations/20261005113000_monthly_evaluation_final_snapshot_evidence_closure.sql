-- Forward-only closure for monthly evaluation final snapshots.
-- Keeps the exact evidence and points truth used at approval time immutable inside the final snapshot.

create or replace function public.trg_monthly_evaluation_final_snapshot_v5()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_engine integer := 0;
  v_evidence jsonb;
  v_snapshot jsonb;
  v_snapshot_hash text;
begin
  if coalesce(new.metrics_snapshot->>'evaluation_engine_version','') ~ '^[0-9]+$' then
    v_engine := (new.metrics_snapshot->>'evaluation_engine_version')::integer;
  end if;

  if v_engine < 5 or new.status not in ('sent','approved') then
    return new;
  end if;

  v_evidence := public.dawaa_monthly_evaluation_server_evidence_v5(new.staff_id,new.evaluation_month);

  if not coalesce((v_evidence->>'ready')::boolean,false) then
    raise exception 'monthly_evaluation_server_evidence_unavailable'
      using errcode='55000',
            detail=coalesce(v_evidence->'errors','{}'::jsonb)::text;
  end if;

  new.metrics_snapshot := coalesce(new.metrics_snapshot,'{}'::jsonb)
    || jsonb_build_object(
      'evidence_ready',true,
      'evidence_health',v_evidence->'health',
      'server_evidence_snapshot',v_evidence
    );

  v_snapshot := jsonb_build_object(
    'schema','monthly_evaluation_final_snapshot_v5',
    'evaluation_id',new.id,
    'staff_id',new.staff_id,
    'staff_name',new.staff_name,
    'staff_role',new.staff_role,
    'branch',new.branch,
    'evaluation_month',new.evaluation_month,
    'cycle_label',to_char(new.evaluation_month,'YYYY-MM'),
    'evaluator_id',new.evaluator_id,
    'evaluator_name',new.evaluator_name,
    'evaluator_role',new.evaluator_role,
    'sections',new.sections,
    'strengths',to_jsonb(new.strengths),
    'development_points',to_jsonb(new.development_points),
    'manager_notes',new.manager_notes,
    'overall_score',new.overall_score,
    'grade',new.grade,
    'active_critical_gates',coalesce(new.metrics_snapshot->'active_critical_gates','[]'::jsonb),
    'axis_evidence_snapshot',coalesce(new.metrics_snapshot->'axis_evidence_snapshot','[]'::jsonb),
    'points_truth',new.metrics_snapshot->'points_truth',
    'server_evidence',v_evidence,
    'coaching_snapshot',new.metrics_snapshot->'coaching_snapshot',
    'employee_feedback_draft',new.metrics_snapshot->'employee_feedback_draft',
    'approved_at',coalesce(new.sent_at,now())
  );

  v_snapshot_hash := md5(v_snapshot::text);

  new.metrics_snapshot := new.metrics_snapshot
    || jsonb_build_object(
      'final_approval_snapshot',v_snapshot,
      'final_approval_hash',v_snapshot_hash,
      'final_approval_snapshot_schema','monthly_evaluation_final_snapshot_v5'
    );

  return new;
end;
$function$;

drop trigger if exists zz_monthly_evaluation_final_snapshot_v5
  on public.staff_monthly_manager_evaluations;

create trigger zz_monthly_evaluation_final_snapshot_v5
before insert or update of sections,metrics_snapshot,strengths,development_points,manager_notes,status,sent_at
on public.staff_monthly_manager_evaluations
for each row
execute function public.trg_monthly_evaluation_final_snapshot_v5();

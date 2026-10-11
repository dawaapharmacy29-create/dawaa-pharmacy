-- Critical monthly-evaluation gates can materially reduce incentive payout.
-- Require a separate documented rationale for every active gate and freeze it in the final snapshot.

create or replace function public.trg_monthly_evaluation_critical_gate_rationale_v5()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_gate text;
  v_rationales jsonb := coalesce(new.metrics_snapshot->'critical_gate_rationales','{}'::jsonb);
begin
  if new.status not in ('sent','approved') then return new; end if;
  if jsonb_typeof(coalesce(new.metrics_snapshot->'active_critical_gates','[]'::jsonb)) <> 'array' then
    raise exception 'monthly_evaluation_critical_gates_invalid';
  end if;
  if jsonb_typeof(v_rationales) <> 'object' then
    raise exception 'monthly_evaluation_critical_gate_rationales_invalid';
  end if;

  for v_gate in
    select jsonb_array_elements_text(coalesce(new.metrics_snapshot->'active_critical_gates','[]'::jsonb))
  loop
    if v_gate not in (
      'unexplained_cash_shortage','data_manipulation','ignored_serious_complaint',
      'unescalated_critical_issue','repeated_negligence'
    ) then
      raise exception 'monthly_evaluation_unknown_critical_gate';
    end if;
    if char_length(btrim(coalesce(v_rationales->>v_gate,''))) < 12 then
      raise exception 'monthly_evaluation_critical_gate_rationale_required'
        using errcode='23514',
              detail='Every active critical gate requires its own documented rationale of at least 12 characters.';
    end if;
  end loop;
  return new;
end;
$function$;

drop trigger if exists zx_monthly_evaluation_critical_gate_rationale_v5
  on public.staff_monthly_manager_evaluations;
create trigger zx_monthly_evaluation_critical_gate_rationale_v5
before insert or update of metrics_snapshot,status
on public.staff_monthly_manager_evaluations
for each row execute function public.trg_monthly_evaluation_critical_gate_rationale_v5();

-- Extend the final immutable approval snapshot with the per-gate decision evidence.
create or replace function public.trg_monthly_evaluation_final_snapshot_v5()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_catalog'
as $function$
declare
  v_snapshot jsonb;
  v_hash text;
  v_evidence jsonb;
begin
  if new.status not in ('sent','approved') then return new; end if;

  v_evidence := coalesce(new.metrics_snapshot->'server_evidence','{}'::jsonb);
  v_snapshot := jsonb_build_object(
    'evaluation_id',new.id,
    'staff_id',new.staff_id,
    'staff_name',new.staff_name,
    'staff_role',new.staff_role,
    'branch',new.branch,
    'evaluation_month',new.evaluation_month,
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
    'critical_gate_rationales',coalesce(new.metrics_snapshot->'critical_gate_rationales','{}'::jsonb),
    'axis_evidence_snapshot',coalesce(new.metrics_snapshot->'axis_evidence_snapshot','[]'::jsonb),
    'points_truth',new.metrics_snapshot->'points_truth',
    'server_evidence',v_evidence,
    'coaching_snapshot',new.metrics_snapshot->'coaching_snapshot',
    'employee_feedback_draft',new.metrics_snapshot->'employee_feedback_draft',
    'approved_at',coalesce(new.sent_at,now())
  );
  v_hash := encode(digest(convert_to(v_snapshot::text,'UTF8'),'sha256'),'hex');
  new.metrics_snapshot := coalesce(new.metrics_snapshot,'{}'::jsonb) || jsonb_build_object(
    'final_approval_snapshot',v_snapshot,
    'final_approval_hash',v_hash
  );
  return new;
end;
$function$;

drop trigger if exists zz_monthly_evaluation_final_snapshot_v5
  on public.staff_monthly_manager_evaluations;
create trigger zz_monthly_evaluation_final_snapshot_v5
before insert or update of status,sections,metrics_snapshot,strengths,development_points,manager_notes,overall_score,grade,sent_at
on public.staff_monthly_manager_evaluations
for each row execute function public.trg_monthly_evaluation_final_snapshot_v5();

revoke all on function public.trg_monthly_evaluation_critical_gate_rationale_v5() from public;
revoke all on function public.trg_monthly_evaluation_critical_gate_rationale_v5() from anon;
revoke all on function public.trg_monthly_evaluation_critical_gate_rationale_v5() from authenticated;

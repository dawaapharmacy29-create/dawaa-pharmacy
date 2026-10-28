-- Keep status=draft for compatibility with V5 readers. A server-verified
-- workflow marker distinguishes editable drafts from submitted drafts.
-- Authorized actor identity and role are assigned by save_staff_monthly_evaluation_v5.
create or replace function public.trg_monthly_evaluation_submission_guard_v1()
returns trigger language plpgsql security invoker
set search_path = 'public', 'pg_catalog'
as $function$
declare
  old_state text := '';
  new_state text := '';
  rationale text := '';
begin
  new_state := coalesce(new.metrics_snapshot #>> '{review_workflow,state}', '');
  if tg_op = 'UPDATE' then
    old_state := coalesce(old.metrics_snapshot #>> '{review_workflow,state}', '');
  end if;

  if new_state not in ('', 'editing', 'submitted', 'returned') then
    raise exception 'monthly_evaluation_invalid_review_state' using errcode='23514';
  end if;

  if coalesce(new.evaluator_role,'') in
    ('branch_manager','branch_manager_shamy','branch_manager_shokry') then
    if new.status in ('sent','approved') then
      raise exception 'monthly_evaluation_requires_branches_manager_approval'
        using errcode='23514';
    end if;
    if old_state = 'submitted' then
      raise exception 'monthly_evaluation_submitted_locked_for_branch_manager'
        using errcode='23514';
    end if;
    if new_state = 'returned' then
      raise exception 'monthly_evaluation_return_requires_branches_manager'
        using errcode='23514';
    end if;
  end if;

  if new_state='submitted' and old_state is distinct from 'submitted' then
    if new.status <> 'draft' then
      raise exception 'monthly_evaluation_submit_requires_draft' using errcode='23514';
    end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(new.sections,'[]'::jsonb)) section
      where coalesce((section->>'score')::numeric,0) <= 0
    ) then
      raise exception 'monthly_evaluation_submit_requires_all_scores' using errcode='23514';
    end if;
    if exists (
      select 1 from jsonb_array_elements(coalesce(new.sections,'[]'::jsonb)) section
      where section->>'key'='inventory'
        and length(btrim(coalesce(section->>'notes',''))) < 12
    ) then
      raise exception 'monthly_evaluation_inventory_submit_requires_rationale' using errcode='23514';
    end if;
    new.metrics_snapshot := jsonb_set(new.metrics_snapshot, '{review_workflow}',
      jsonb_build_object('state','submitted', 'submitted_at',now(),
        'submitted_by',new.evaluator_id), true);
  end if;

  if new_state='returned' and old_state='submitted' then
    if coalesce(new.evaluator_role,'') not in
      ('branches_manager','general_manager','executive_manager','executive','admin') then
      raise exception 'monthly_evaluation_return_not_allowed' using errcode='23514';
    end if;
    rationale := btrim(coalesce(new.metrics_snapshot #>> '{review_workflow,return_reason}',''));
    if length(rationale) < 12 then
      raise exception 'monthly_evaluation_return_reason_required' using errcode='23514';
    end if;
    new.metrics_snapshot := jsonb_set(new.metrics_snapshot, '{review_workflow}',
      jsonb_build_object('state','returned', 'returned_at',now(),
        'returned_by',new.evaluator_id, 'return_reason',rationale), true);
  end if;

  return new;
end;
$function$;

drop trigger if exists zy_monthly_evaluation_submission_guard_v1
  on public.staff_monthly_manager_evaluations;
create trigger zy_monthly_evaluation_submission_guard_v1
before insert or update of metrics_snapshot,sections,status,evaluator_role
on public.staff_monthly_manager_evaluations
for each row execute function public.trg_monthly_evaluation_submission_guard_v1();

revoke all on function public.trg_monthly_evaluation_submission_guard_v1()
  from public,anon,authenticated;

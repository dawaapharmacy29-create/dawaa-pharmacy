-- Separate branches-manager checklist entries and weekly evaluations by branch.

alter table public.manager_daily_checklist
  drop constraint if exists manager_daily_checklist_staff_id_task_date_task_key_key;

alter table public.manager_daily_checklist
  add constraint manager_daily_checklist_staff_date_task_branch_key
  unique nulls not distinct (staff_id, task_date, task_key, branch);

alter table public.manager_weekly_evaluations
  drop constraint if exists manager_weekly_evaluations_evaluation_type_subject_staff_id_key;

alter table public.manager_weekly_evaluations
  add constraint manager_weekly_evaluations_type_subject_week_branch_key
  unique nulls not distinct (evaluation_type, subject_staff_id, week_start, branch);

create or replace function public.calculate_weekly_checklist_completion_v4(
  p_staff_id text,
  p_week_start date,
  p_week_end date,
  p_task_cadences jsonb default '{}'::jsonb,
  p_branch text default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_task_key text;
  v_cadence text;
  v_completed_count integer;
  v_expected_count integer;
  v_effective_end date;
  v_aliases text[];
begin
  if p_staff_id is null or btrim(p_staff_id) = '' then return v_result; end if;
  if p_week_start is null or p_week_end is null or p_week_end < p_week_start then
    raise exception 'Invalid checklist date range';
  end if;
  v_effective_end := least(p_week_end,current_date);

  for v_task_key,v_cadence in
    select key,lower(value #>> '{}') from jsonb_each(coalesce(p_task_cadences,'{}'::jsonb))
  loop
    v_aliases := case v_task_key
      when 'points_communication_review' then array['points_communication_review','points_tracking']
      when 'doctor_requests_followup' then array['doctor_requests_followup','exceptional_followup_execution','followups_execution_review']
      when 'app_requests_followup' then array['app_requests_followup','exceptional_followup_execution','followups_execution_review']
      when 'complaints_followup' then array['complaints_followup','customer_requests_tracking']
      when 'branches_manager_list_followup' then array['branches_manager_list_followup','branches_manager_notes_followup']
      when 'top20_new_customers_growth' then array['top20_new_customers_growth','customer_growth_check']
      else array[v_task_key]
    end;

    select count(distinct task_date)::integer into v_completed_count
    from public.manager_daily_checklist
    where staff_id::text = p_staff_id
      and task_key = any(v_aliases)
      and completed is true
      and task_date between p_week_start and p_week_end
      and (p_branch is null or branch = p_branch);

    v_expected_count := case
      when v_cadence in ('weekly','monthly') then 1
      when v_effective_end < p_week_start then 1
      else greatest(1,(v_effective_end-p_week_start)+1)
    end;

    v_result := v_result || jsonb_build_object(
      v_task_key,
      least(100,round((coalesce(v_completed_count,0)::numeric/v_expected_count::numeric)*100,1))
    );
  end loop;
  return v_result;
end;
$$;

grant execute on function public.calculate_weekly_checklist_completion_v4(text,date,date,jsonb,text)
to anon, authenticated;

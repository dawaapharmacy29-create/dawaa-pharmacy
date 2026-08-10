-- Cadence-aware scoring for manager checklists.
-- Daily tasks are expected once per elapsed day in the requested week.
-- Weekly/monthly tasks are expected once in the requested range.
-- SECURITY INVOKER keeps the existing manager_daily_checklist RLS policies authoritative.

create or replace function public.calculate_weekly_checklist_completion_v2(
  p_staff_id text,
  p_week_start date,
  p_week_end date,
  p_task_cadences jsonb default '{}'::jsonb
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
begin
  if p_staff_id is null or btrim(p_staff_id) = '' then
    return v_result;
  end if;

  if p_week_start is null or p_week_end is null or p_week_end < p_week_start then
    raise exception 'Invalid checklist date range';
  end if;

  v_effective_end := least(p_week_end, current_date);

  for v_task_key, v_cadence in
    select key, lower(value #>> '{}')
    from jsonb_each(coalesce(p_task_cadences, '{}'::jsonb))
  loop
    select count(distinct task_date)::integer
      into v_completed_count
    from public.manager_daily_checklist
    where staff_id::text = p_staff_id
      and task_key = v_task_key
      and completed is true
      and task_date between p_week_start and p_week_end;

    v_expected_count := case
      when v_cadence in ('weekly', 'monthly') then 1
      when v_effective_end < p_week_start then 1
      else greatest(1, (v_effective_end - p_week_start) + 1)
    end;

    v_result := v_result || jsonb_build_object(
      v_task_key,
      least(100, round((coalesce(v_completed_count, 0)::numeric / v_expected_count::numeric) * 100, 1))
    );
  end loop;

  return v_result;
end;
$$;

comment on function public.calculate_weekly_checklist_completion_v2(text, date, date, jsonb)
is 'Returns cadence-aware manager checklist percentages while preserving manager_daily_checklist RLS.';

grant execute on function public.calculate_weekly_checklist_completion_v2(text, date, date, jsonb)
to anon, authenticated;
